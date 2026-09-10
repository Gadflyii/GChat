#Requires -Version 5.1
<#
.SYNOPSIS
Preview or install GInferHost. Does not start services or download/change engines.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Binary,
    [Parameter(Mandatory)][string]$Engine,
    [Parameter(Mandatory)][string]$Prefix,
    [Parameter(Mandatory)][string]$DataDir,
    [string[]]$Models = @(),
    [string[]]$ArtifactSet = @(),
    [string]$Name = 'GInfer host',
    [switch]$ShareLan,
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Quote-Argument([string]$Value) {
    if ($Value -match '[\x00-\x1f]') { throw 'Control characters are not permitted in service arguments' }
    # Windows CRT argv rules: double backslashes before quotes and at quoted EOF.
    $Value = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $Value = [regex]::Replace($Value, '(\\+)$', '$1$1')
    return '"' + $Value + '"'
}
function Existing-Path([string]$Value, [bool]$Directory) {
    $item = Get-Item -LiteralPath $Value
    if ($item.PSIsContainer -ne $Directory) { throw "Wrong path type: $Value" }
    return $item.FullName
}
function New-LocalPath([string]$Value) {
    $path = [IO.Path]::GetFullPath($Value)
    if ($path -notmatch '^[A-Za-z]:\\' -or $path.TrimEnd('\') -eq [IO.Path]::GetPathRoot($path).TrimEnd('\')) {
        throw 'Installation/state paths must be dedicated local directories, not drive roots or UNC paths'
    }
    if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite existing directory: $path" }
    return $path.TrimEnd('\')
}
function Private-Directory([string]$Path) {
    New-Item -ItemType Directory -Path $Path | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Grant-Service([string]$Path, [string]$Rights, [bool]$Directory) {
    $acl = Get-Acl -LiteralPath $Path
    $inherit = if ($Directory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $rule = New-Object Security.AccessControl.FileSystemAccessRule('NT SERVICE\GInferHost', $Rights, $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

$Binary = Existing-Path $Binary $false
$Engine = Existing-Path $Engine $false
$Models = @($Models | ForEach-Object { Existing-Path $_ $true })
$ArtifactSet = @($ArtifactSet | ForEach-Object { Existing-Path $_ $false })
$Prefix = New-LocalPath $Prefix
$DataDir = New-LocalPath $DataDir
if ($Prefix.Equals($DataDir, [StringComparison]::OrdinalIgnoreCase) -or
    $Prefix.StartsWith($DataDir + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $DataDir.StartsWith($Prefix + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installation and state directories must be separate, non-nested paths'
}
if (Get-Service -Name GInferHost -ErrorAction SilentlyContinue) { throw 'GInferHost already exists; stop and review it before replacing the installation' }
$destination = Join-Path $Prefix 'ginfer-host.exe'
$launcherPath = Join-Path $Prefix 'ginfer-launch.json'
$launcherJson = @{ data_dir = $DataDir; host_url = 'https://127.0.0.1:7443' } | ConvertTo-Json
$arguments = @($destination, '--windows-service', '--data-dir', $DataDir, '--engine', $Engine, '--name', $Name)
foreach ($model in $Models) { $arguments += @('--models', $model) }
foreach ($descriptor in $ArtifactSet) { $arguments += @('--artifact-set', $descriptor) }
if ($ShareLan) { $arguments += @('--listen', '0.0.0.0:7443', '--discoverable') }
$commandLine = ($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
Write-Output "Service: GInferHost (NT SERVICE\GInferHost; manual start)"
Write-Output "Command: $commandLine"
Write-Output "Private state: $DataDir"
Write-Output "Launcher configuration: $launcherPath"
Write-Output 'Engine/model files and their existing access controls will not be changed.'
Write-Output 'The service account needs read/execute access to the engine runtime and read access to model roots/descriptors and their declared members.'
if (-not $Install) {
    Write-Output 'Preview only. Repeat with -Install from an elevated PowerShell to install without starting.'
    return
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Installation requires an elevated PowerShell' }
Private-Directory $Prefix
Private-Directory $DataDir
Copy-Item -LiteralPath $Binary -Destination $destination
$profiles = Join-Path (Split-Path -Parent $Binary) 'launch-profiles.json'
if (Test-Path -LiteralPath $profiles -PathType Leaf) {
    Copy-Item -LiteralPath $profiles -Destination (Join-Path $Prefix 'launch-profiles.json')
}
[IO.File]::WriteAllText($launcherPath, $launcherJson, (New-Object Text.UTF8Encoding($false)))
# Virtual account isolates host secrets from other low-privilege Windows services.
# Explicit manual start prevents a partially installed service from auto-starting.
$created = Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{
    Name = 'GInferHost'; DisplayName = 'GInfer LAN Host'; PathName = $commandLine
    ServiceType = [byte]16; ErrorControl = [byte]1; StartMode = 'Manual'
    DesktopInteract = $false; StartName = 'NT SERVICE\GInferHost'
}
if ($created.ReturnValue -ne 0) { throw "SCM creation failed ($($created.ReturnValue)); private installation files retained for inspection" }
Grant-Service $Prefix 'ReadAndExecute' $true
Grant-Service $DataDir 'Modify' $true
Write-Output 'Installed, not started. Review runtime/model access, then: Start-Service GInferHost'
Write-Output ('Open the local-admin launch menu: & ' + (Quote-Argument $destination) + ' --menu')
Write-Output 'To start on boot after qualification: Set-Service GInferHost -StartupType Automatic'
Write-Output ('Pair from an elevated terminal: & ' + (Quote-Argument $destination) + ' --data-dir ' + (Quote-Argument $DataDir) + ' --request-pairing')
if ($ShareLan) { Write-Output 'Allow TCP 7443 and UDP 5353 on the trusted LAN only. No firewall rules were changed.' }
