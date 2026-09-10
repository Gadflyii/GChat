#Requires -Version 5.1
<# .SYNOPSIS
Install a bundled GInfer runtime for the current user without starting inference.
#>
[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'GInfer'),
    [string]$ProviderDirectory = (Join-Path $env:APPDATA 'GInfer\data'),
    [switch]$NoPath,
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$bundle = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $bundle 'runtime'
$hostBinary = Join-Path $bundle 'bin\ginfer-host.exe'
if ($PSBoundParameters.Count -eq 0) {
    Write-Host 'GInfer setup — press Enter to accept each default.'
    $answer = Read-Host "Install binaries [$InstallDirectory]"
    if ($answer.Trim()) { $InstallDirectory = $answer.Trim() }
    if (-not (Test-Path -LiteralPath (Join-Path $env:APPDATA 'GInfer\local-host.json'))) {
        $answer = Read-Host "Store models and host state [$ProviderDirectory]"
        if ($answer.Trim()) { $ProviderDirectory = $answer.Trim() }
    } else {
        Write-Host 'Your registered host and its storage will be reused.'
    }
    if ((Read-Host 'Install for this user? [y/N]') -notmatch '^(y|yes)$') { return }
    $Install = $true
}

function Local-Directory([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:\\') { throw 'Choose an absolute local directory, not a UNC or relative path' }
    $path = [IO.Path]::GetFullPath($Value).TrimEnd('\')
    if ($path -eq [IO.Path]::GetPathRoot($path).TrimEnd('\')) { throw 'Choose a dedicated directory, not a drive root' }
    return $path
}

$destination = Local-Directory $InstallDirectory
if (Test-Path -LiteralPath $destination) { throw "Installation directory already exists; it will not be overwritten: $destination" }
if (-not (Test-Path -LiteralPath $hostBinary -PathType Leaf)) { throw 'Bundle is missing ginfer-host.exe' }
$manifest = Get-Content -LiteralPath (Join-Path $runtime 'runtime-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.schema -ne 'ginfer-windows-runtime-v1' -or $manifest.platform -ne 'windows-x64') {
    throw 'Unsupported engine runtime manifest'
}
$members = @{}
foreach ($entry in $manifest.files) {
    $name = [string]$entry.path
    if ($name -notmatch '^(bin/[A-Za-z0-9_.-]+\.(exe|dll)|licenses/[A-Za-z0-9_.-]+\.txt|README\.md|LICENSE)$' -or $members.ContainsKey($name)) {
        throw "Unexpected or duplicate runtime member: $name"
    }
    $source = Join-Path $runtime $name
    $file = Get-Item -LiteralPath $source
    if ($file.PSIsContainer -or $file.Length -ne $entry.bytes -or
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) {
        throw "Runtime integrity mismatch: $name"
    }
    $members[$name] = $source
}
foreach ($required in @('bin/ginfer.exe', 'bin/ginfer-serve.exe')) {
    if (-not $members.ContainsKey($required)) { throw "Runtime is missing $required" }
}
if ($members.ContainsKey('bin/ginfer-host.exe')) { throw 'Engine runtime must not supply the host owner binary' }
if (-not $env:APPDATA) { throw 'APPDATA is unavailable' }
$locator = Join-Path $env:APPDATA 'GInfer\local-host.json'
$configuration = $null
if (Test-Path -LiteralPath $locator) {
    $registered = Get-Content -LiteralPath $locator -Raw | ConvertFrom-Json
    if ($registered.schema -ne 'ginfer-local-host-v1') { throw 'Unsupported local host locator; existing registration was left unchanged' }
    Write-Output "Existing host will be reused: $locator"
} else {
    if (-not $ProviderDirectory) { throw 'For a first installation, specify -ProviderDirectory for host state and managed models' }
    $provider = Local-Directory $ProviderDirectory
    if ($provider.Equals($destination, [StringComparison]::OrdinalIgnoreCase) -or
        $provider.StartsWith($destination + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $destination.StartsWith($provider + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime installation and model storage must be separate, non-nested directories'
    }
    $configuration = @{
        data_dir = Join-Path $provider 'host'
        host_url = 'https://127.0.0.1:7443'
        desktop = @{ provider = $provider; engine = Join-Path $destination 'bin\ginfer-serve.exe' }
    }
    Write-Output "Host state and managed models: $provider (created by the host on first launch)"
}
Write-Output "Runtime installation: $destination"
if (-not $NoPath) { Write-Output 'Setup adds its bin directory to your user PATH.' }
Write-Output 'Setup does not start services, load models, or replace an existing host.'
if (-not $Install) {
    Write-Output 'Preview only. Repeat with -Install to install for this user; no administrator rights are needed.'
    return
}
# Create exclusively; a concurrent setup must not overwrite this installation.
New-Item -ItemType Directory -Path $destination | Out-Null
foreach ($name in $members.Keys) {
    $target = Join-Path $destination $name
    [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
    Copy-Item -LiteralPath $members[$name] -Destination $target
}
Copy-Item -LiteralPath (Join-Path $runtime 'runtime-manifest.json') -Destination $destination
$bin = Join-Path $destination 'bin'
Copy-Item -LiteralPath $hostBinary -Destination (Join-Path $bin 'ginfer-host.exe')
$profiles = Join-Path $bundle 'bin\launch-profiles.json'
if (Test-Path -LiteralPath $profiles -PathType Leaf) {
    Copy-Item -LiteralPath $profiles -Destination (Join-Path $bin 'launch-profiles.json')
}
if ($null -ne $configuration) {
    [IO.File]::WriteAllText((Join-Path $bin 'ginfer-launch.json'),
        ($configuration | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
}
if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $paths = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $bin })
    [Environment]::SetEnvironmentVariable('Path', ((@($bin) + $paths) -join ';'), 'User')
}
if (-not $NoPath) { Write-Output 'Installed. In a new terminal, type ginfer.' }
Write-Output "Launch now: & '$bin\ginfer.exe'"
