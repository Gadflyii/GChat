#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$HostBinary)
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\scripts\install-ginfer-host-windows.ps1'
$testRoot = Join-Path $env:TEMP ('gchat-host-preview-' + [guid]::NewGuid().ToString('N'))
$parameters = @{
    Binary = $HostBinary; Engine = $HostBinary
    Prefix = Join-Path $testRoot 'host bin'; DataDir = Join-Path $testRoot 'private state'
    Models = @((Split-Path -Parent $HostBinary)); Name = 'Lab "quoted" $NAME'; ShareLan = $true
}
$output = (& $installer @parameters) -join "`n"
if ($output -notmatch 'Preview only' -or $output -notmatch '\-\-windows-service' -or $output -notmatch '\-\-discoverable') {
    throw "Expected service preview: $output"
}
if (-not $output.Contains('"Lab \"quoted\" $NAME"')) { throw 'Service argument quoting changed the name' }
if (Test-Path -LiteralPath $testRoot) { throw 'Preview wrote installation/state files' }
$parameters.DataDir = Join-Path $parameters.Prefix 'nested-state'
$rejected = $false
try { & $installer @parameters | Out-Null } catch {
    if ($_.Exception.Message -notmatch 'non-nested') { throw }
    $rejected = $true
}
if (-not $rejected) { throw 'Nested executable/state paths were accepted' }
if (Test-Path -LiteralPath $testRoot) { throw 'Rejected preview wrote files' }
Write-Output 'Windows installer preview, quoting, isolation, and non-mutation checks passed.'
