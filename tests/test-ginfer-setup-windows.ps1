#Requires -Version 5.1
param([Parameter(Mandatory)][string]$Setup)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path ([IO.Path]::GetTempPath()) ('ginfer-setup-test-' + [Guid]::NewGuid().ToString('N'))
$savedAppData = $env:APPDATA
$savedLocalAppData = $env:LOCALAPPDATA
try {
    $env:APPDATA = Join-Path $root 'roaming'
    $env:LOCALAPPDATA = Join-Path $root 'local'
    $bundle = Join-Path $root 'bundle'
    foreach ($sub in @('scripts', 'bin', 'runtime\bin')) {
        [IO.Directory]::CreateDirectory((Join-Path $bundle $sub)) | Out-Null
    }
    $script = Join-Path $bundle 'scripts\setup-ginfer-windows.ps1'
    Copy-Item -LiteralPath $Setup -Destination $script
    [IO.File]::WriteAllText((Join-Path $bundle 'bin\ginfer-host.exe'), 'fixture; never executed')
    $profiles = '{"schema":"ginfer-launch-profiles-v1","profiles":[]}'
    [IO.File]::WriteAllText((Join-Path $bundle 'bin\launch-profiles.json'), $profiles)
    $files = @()
    foreach ($name in @('ginfer.exe', 'ginfer-serve.exe')) {
        $file = Join-Path $bundle "runtime\bin\$name"
        [IO.File]::WriteAllText($file, 'fixture; never executed')
        $files += @{ path = "bin/$name"; bytes = (Get-Item $file).Length; sha256 = (Get-FileHash $file).Hash }
    }
    @{ schema = 'ginfer-windows-runtime-v1'; platform = 'windows-x64'; files = $files } |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $bundle 'runtime\runtime-manifest.json')
    $target = Join-Path $env:LOCALAPPDATA 'GInfer'
    & $script -NoPath
    if (Test-Path $target) { throw 'Preview wrote installation files' }
    & $script -Install -NoPath
    $config = Get-Content (Join-Path $target 'bin\ginfer-launch.json') -Raw | ConvertFrom-Json
    if ($config.desktop.provider -ne (Join-Path $env:APPDATA 'GInfer\data')) { throw 'Wrong default provider' }
    if (Test-Path $config.desktop.provider) { throw 'Setup must not create host/model storage' }
    if (-not (Test-Path (Join-Path $target 'bin\ginfer-host.exe'))) { throw 'Host is not a launcher sibling' }
    if ([IO.File]::ReadAllText((Join-Path $target 'bin\launch-profiles.json')) -ne $profiles) { throw 'Profile catalog was not installed' }
    $rejected = $false
    try { & $script -Install -NoPath } catch { $rejected = $true }
    if (-not $rejected) { throw 'Setup overwrote an existing installation' }
    $locatorDir = Join-Path $env:APPDATA 'GInfer'
    [IO.Directory]::CreateDirectory($locatorDir) | Out-Null
    $locator = Join-Path $locatorDir 'local-host.json'
    $record = '{"schema":"ginfer-local-host-v1","owner":{"mode":"service","directory":"C:\\existing-host","origin":"https://127.0.0.1:7443"}}'
    [IO.File]::WriteAllText($locator, $record)
    $second = Join-Path $root 'second-install'
    & $script -InstallDirectory $second -Install -NoPath
    if (Test-Path (Join-Path $second 'bin\ginfer-launch.json')) { throw 'Setup created a competing owner configuration' }
    if ([IO.File]::ReadAllText($locator) -ne $record) { throw 'Setup altered the registered owner' }
    [IO.File]::AppendAllText((Join-Path $bundle 'runtime\bin\ginfer.exe'), 'corrupted')
    $bad = Join-Path $root 'rejected'
    $rejected = $false
    try { & $script -InstallDirectory $bad -Install -NoPath } catch { $rejected = $true }
    if (-not $rejected -or (Test-Path $bad)) { throw 'Invalid runtime was installed' }
    Write-Output 'PASS: default paths, preview, complete sibling installation, owner preservation, overwrite and integrity rejection.'
} finally {
    $env:APPDATA = $savedAppData
    $env:LOCALAPPDATA = $savedLocalAppData
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
