#Requires -Version 5.1
#Requires -RunAsAdministrator
<# Actual SCM lifecycle test. Loads no model. Removes only its own service registration. #>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$HostBinary, [string]$ReportPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($ReportPath) { Start-Transcript -Path $ReportPath | Out-Null }
$installer = Join-Path $PSScriptRoot '..\scripts\install-ginfer-host-windows.ps1'
if (Get-Service GInferHost -ErrorAction SilentlyContinue) { throw 'Existing GInferHost must not be disturbed' }
if (Get-NetTCPConnection -State Listen -LocalPort 7443 -ErrorAction SilentlyContinue) { throw 'Test port 7443 is occupied' }
$testRoot = Join-Path $env:ProgramData ('GChat\host-scm-test-' + [guid]::NewGuid().ToString('N'))
$prefix = Join-Path $testRoot 'bin'
$state = Join-Path $testRoot 'state'
$models = Join-Path $testRoot 'models'
$destination = Join-Path $prefix 'ginfer-host.exe'
New-Item -ItemType Directory -Path $models | Out-Null
$enginePlaceholder = Join-Path $models 'unused-engine.exe'
Copy-Item -LiteralPath $HostBinary -Destination $enginePlaceholder
try {
    # Engine is deliberately an inert placeholder: with empty inventory, no
    # launch is requested. This test qualifies SCM, not Windows GPU inference.
    & $installer -Binary $HostBinary -Engine $enginePlaceholder -Prefix $prefix -DataDir $state -Models $models -Name 'SCM qualification' -Install | Out-Null
    $acl = Get-Acl -LiteralPath $models
    $rule = New-Object Security.AccessControl.FileSystemAccessRule('NT SERVICE\GInferHost', 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $models -AclObject $acl
    $original = $null
    for ($cycle = 0; $cycle -lt 2; $cycle++) {
        Start-Service GInferHost
        $service = Get-Service GInferHost
        try { $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) } finally { $service.Dispose() }
        $record = Get-CimInstance Win32_Service -Filter "Name='GInferHost'"
        if ($record.StartName -ne 'NT SERVICE\GInferHost') { throw 'Incorrect service identity' }
        $ownedPid = $record.ProcessId
        $activation = (& $destination --data-dir $state --request-pairing 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0 -or $activation -notmatch 'Pairing code \(5 minutes\): \d{8}') { throw 'SCM service did not support pinned local pairing activation' }
        $identity = Get-Content -LiteralPath (Join-Path $state 'host.json') -Raw | ConvertFrom-Json
        if ($cycle -eq 0) { $original = $identity.host_id }
        elseif ($identity.host_id -ne $original) { throw 'Restart replaced durable host identity' }
        Stop-Service GInferHost
        $service = Get-Service GInferHost
        try { $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) } finally { $service.Dispose() }
        if (Get-Process -Id $ownedPid -ErrorAction SilentlyContinue) { throw 'Stopped service left its process running' }
    }
    Write-Output 'SCM virtual-account startup, pinned pairing activation, stop, restart, and persistent identity passed.'
} finally {
    $record = Get-CimInstance Win32_Service -Filter "Name='GInferHost'"
    if ($null -ne $record) {
        if (-not $record.PathName.StartsWith('"' + $destination + '" ', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Service registration changed ownership; refusing cleanup'
        }
        if ($record.State -ne 'Stopped') { Stop-Service GInferHost }
        $deleted = Invoke-CimMethod -InputObject $record -MethodName Delete
        if ($deleted.ReturnValue -ne 0) { throw "Temporary service cleanup failed: $($deleted.ReturnValue)" }
        Write-Output 'Temporary GInferHost service registration removed.'
    }
    Write-Output "Private test files retained for inspection: $testRoot"
    $diagnostic = Join-Path $state 'service-status.txt'
    if (Test-Path -LiteralPath $diagnostic) { Get-Content -LiteralPath $diagnostic }
    if ($ReportPath) { Stop-Transcript | Out-Null }
}
