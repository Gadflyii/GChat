#Requires -Version 5.1
# scripts/build-windows-release.ps1
# GChat - Windows release builder (local, no code signing)
# Mirrors CI pipeline from release.yml: NSIS + MSI installers.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-windows-release.ps1
#   - or -
#   make build-windows-release

param(
    # Internal flags used when a build is relaunched from the native mirror.
    [switch]$NativeMirror,
    [string]$SourceRoot
)

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot | Split-Path

if ((-not $NativeMirror) -and $projectRoot.StartsWith('\\')) {
    $nativeBuildRoot = if ($env:GCHAT_WINDOWS_BUILD_ROOT) {
        $env:GCHAT_WINDOWS_BUILD_ROOT
    } else {
        Join-Path $env:LOCALAPPDATA 'GChat\windows-build'
    }
    $nativeSourceRoot = Join-Path $nativeBuildRoot 'source'

    # cmd-backed tools cannot inherit a UNC working directory. Keep all Windows
    # dependencies and compiler output on NTFS, while the WSL checkout remains
    # the authoritative source tree.
    Set-Location ([System.IO.Path]::GetPathRoot($nativeBuildRoot))
    New-Item -ItemType Directory -Path $nativeSourceRoot -Force | Out-Null

    Write-Host ''
    Write-Host '>>> Staging WSL source for a native Windows build' -ForegroundColor Cyan
    Write-Host "  Source: $projectRoot"
    Write-Host "  Build:  $nativeSourceRoot"

    $excludedDirectories = @(
        '.git', '.yarn', '.cache', '.next', '.turbo', '.vite',
        'node_modules', 'target', 'coverage', 'dist', 'dist-web',
        'dist-ssr', 'build', 'out', 'pre-install', '__pycache__',
        'docs', 'autoqa', 'tests',
        (Join-Path $projectRoot 'core\lib'),
        (Join-Path $projectRoot 'src-tauri\resources\bin'),
        (Join-Path $projectRoot 'src-tauri\resources\pre-install')
    )
    $robocopyArgs = @(
        $projectRoot,
        $nativeSourceRoot,
        '/MIR',
        '/COPY:DAT',
        '/DCOPY:DAT',
        '/R:2',
        '/W:1',
        '/NFL',
        '/NDL',
        '/NP',
        '/NJH',
        '/NJS',
        '/XD'
    ) + $excludedDirectories

    & robocopy.exe @robocopyArgs
    $robocopyExit = $LASTEXITCODE
    if ($robocopyExit -gt 7) {
        Write-Host "[FATAL] Source staging failed (robocopy exit $robocopyExit)." -ForegroundColor Red
        exit $robocopyExit
    }

    $nativeScript = Join-Path $nativeSourceRoot 'scripts\build-windows-release.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $nativeScript `
        -NativeMirror -SourceRoot $projectRoot
    exit $LASTEXITCODE
}

Set-Location $projectRoot

function Write-Step {
    param([string]$msg)
    Write-Host ''
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Test-Cmd {
    param([string]$cmd)
    return ($null -ne (Get-Command $cmd -ErrorAction SilentlyContinue))
}

function Refresh-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = $machinePath + ';' + $userPath
}

function Assert-Cmd {
    param([string]$cmd, [string]$hint)
    if (-not (Test-Cmd $cmd)) {
        Write-Host "[FATAL] $cmd not found. $hint" -ForegroundColor Red
        Write-Host 'Restart PowerShell, then rerun this same build command.' -ForegroundColor Yellow
        exit 1
    }
}

# The release builder is the public one-command entry point. If the workstation
# has not been prepared yet, run the existing setup first instead of requiring
# the user to discover and execute a separate bootstrap command.
Refresh-SessionPath
$initialCargoPath = Join-Path $env:USERPROFILE '.cargo\bin'
if ((Test-Path $initialCargoPath) -and ($env:Path -notlike "*$initialCargoPath*")) {
    $env:Path = $initialCargoPath + ';' + $env:Path
}
if ((-not (Test-Cmd 'node')) -or (-not (Test-Cmd 'cargo'))) {
    Write-Step 'Installing missing Windows build prerequisites'
    & (Join-Path $projectRoot 'scripts\setup-windows.ps1')
    Refresh-SessionPath
    if (Test-Path $initialCargoPath) {
        $env:Path = $initialCargoPath + ';' + $env:Path
    }
}

# ── Ensure nvm + Node.js are available ────────────────────────
Write-Step 'Ensuring nvm + Node.js are available'
Refresh-SessionPath

if (-not $env:NVM_HOME) {
    $nvmHome = [System.Environment]::GetEnvironmentVariable('NVM_HOME', 'User')
    if (-not $nvmHome) {
        $nvmHome = [System.Environment]::GetEnvironmentVariable('NVM_HOME', 'Machine')
    }
    if (-not $nvmHome) {
        $nvmHome = Join-Path $env:APPDATA 'nvm'
    }
    $env:NVM_HOME = $nvmHome
}

if (-not $env:NVM_SYMLINK) {
    $nvmSymlink = [System.Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'User')
    if (-not $nvmSymlink) {
        $nvmSymlink = [System.Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'Machine')
    }
    if (-not $nvmSymlink) {
        $nvmSymlink = Join-Path $env:ProgramFiles 'nodejs'
    }
    $env:NVM_SYMLINK = $nvmSymlink
}

if ((Test-Path $env:NVM_HOME) -and ($env:Path -notlike "*$($env:NVM_HOME)*")) {
    $env:Path = $env:NVM_HOME + ';' + $env:Path
}
if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
    $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
}

if (-not (Test-Cmd 'node')) {
    if (Test-Cmd 'nvm') {
        Write-Host '  Node.js not found. Installing Node.js 20 via nvm...'
        nvm install 20
        nvm use 20
        Refresh-SessionPath
        if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
            $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
        }
    }
}

# Setup yarn via corepack
if (Test-Cmd 'node') {
    $corepackBin = Join-Path $env:USERPROFILE '.corepack\bin'
    if (-not (Test-Path $corepackBin)) {
        New-Item -ItemType Directory -Path $corepackBin -Force | Out-Null
    }

    $npmPrefix = ((npm prefix -g 2>&1) | Out-String).Trim()
    $npmYarn = Join-Path $npmPrefix 'yarn.cmd'
    if (Test-Path $npmYarn) {
        Write-Host '  Removing conflicting npm-global yarn v1...'
        npm uninstall -g yarn 2>&1 | Out-Null
    }

    Write-Host "  Enabling corepack (shim dir: $corepackBin)..."
    corepack enable --install-directory $corepackBin
    corepack prepare yarn@4.5.3 --activate

    if ($env:Path -notlike "*$corepackBin*") {
        $env:Path = $corepackBin + ';' + $env:Path
    }
}

$cargoPath = Join-Path $env:USERPROFILE '.cargo\bin'
if ((Test-Path $cargoPath) -and ($env:Path -notlike "*\.cargo\bin*")) {
    $env:Path = $cargoPath + ';' + $env:Path
}

# ── Preflight checks ─────────────────────────────────────────
Write-Step 'Preflight checks'
Assert-Cmd 'node'   'Install via: nvm install 20 && nvm use 20'
Assert-Cmd 'cargo'  'Install via: make setup-windows (installs Rust)'

if (-not (Test-Cmd 'yarn')) {
    $searchDirs = @(
        (Join-Path $env:USERPROFILE '.corepack\bin')
    )
    if (Test-Cmd 'node') { $searchDirs += Split-Path (Get-Command node).Source }
    if ($env:NVM_SYMLINK) { $searchDirs += $env:NVM_SYMLINK }

    $yarnFound = $false
    foreach ($dir in $searchDirs) {
        if (Test-Path (Join-Path $dir 'yarn.cmd')) {
            Write-Host "  yarn.cmd found in $dir"
            $env:Path = $dir + ';' + $env:Path
            $yarnFound = $true
            break
        }
    }
    if (-not $yarnFound) {
        Assert-Cmd 'yarn' 'Run: corepack enable --install-directory %USERPROFILE%\.corepack\bin'
    }
}

$nodeVer = (node --version 2>&1) | Out-String
$cargoVer = (cargo --version 2>&1) | Out-String
Write-Host "  node  $($nodeVer.Trim())"
Write-Host "  cargo $($cargoVer.Trim())"
Write-Host '  yarn  OK'

# ── Yarn install ──────────────────────────────────────────────
Write-Step 'yarn install'
yarn config set -H enableImmutableInstalls false 2>&1 | Out-Null
yarn install
if ($LASTEXITCODE -ne 0) { Write-Host 'yarn install failed' -ForegroundColor Red; exit 1 }

# Tauri's bundler patches an updater bundle-type marker into the finished
# executable. The CLI and Rust crate must use the same marker contract; a
# minor-version mismatch can otherwise produce a valid installer whose updater
# cannot identify whether it is NSIS or MSI.
$tauriCliVersion = ((yarn tauri --version 2>&1) | Out-String).Trim()
if (($LASTEXITCODE -ne 0) -or ($tauriCliVersion -notmatch '^tauri-cli (\d+)\.(\d+)\.')) {
    Write-Host "[FATAL] Could not determine the installed Tauri CLI version: $tauriCliVersion" -ForegroundColor Red
    exit 1
}
$tauriCliMajorMinor = "$($Matches[1]).$($Matches[2])"

$cargoLock = Get-Content (Join-Path $projectRoot 'src-tauri\Cargo.lock') -Raw
if ($cargoLock -notmatch '(?ms)\[\[package\]\]\s*name = "tauri"\s*version = "(\d+)\.(\d+)\.') {
    Write-Host '[FATAL] Could not determine the resolved Tauri crate version from src-tauri\Cargo.lock.' -ForegroundColor Red
    exit 1
}
$tauriCrateMajorMinor = "$($Matches[1]).$($Matches[2])"
if ($tauriCliMajorMinor -ne $tauriCrateMajorMinor) {
    Write-Host "[FATAL] Tauri version mismatch: CLI $tauriCliMajorMinor, Rust crate $tauriCrateMajorMinor." -ForegroundColor Red
    Write-Host 'Align @tauri-apps/cli with the resolved tauri crate before building updater packages.' -ForegroundColor Yellow
    exit 1
}
Write-Host "  $tauriCliVersion (matches Rust tauri $tauriCrateMajorMinor.x)"

# ── Build tauri plugin API ────────────────────────────────────
Write-Step 'yarn build:tauri:plugin:api'
yarn build:tauri:plugin:api
if ($LASTEXITCODE -ne 0) { Write-Host 'build:tauri:plugin:api failed' -ForegroundColor Red; exit 1 }

# ── Build core ────────────────────────────────────────────────
Write-Step 'yarn build:core'
yarn build:core
if ($LASTEXITCODE -ne 0) { Write-Host 'build:core failed' -ForegroundColor Red; exit 1 }

# ── Build extensions ──────────────────────────────────────────
Write-Step 'yarn build:extensions'
yarn build:extensions
if ($LASTEXITCODE -ne 0) { Write-Host 'build:extensions failed' -ForegroundColor Red; exit 1 }

# ── Download binaries (bun, uv) ──────────────────────────────
Write-Step 'yarn download:bin'
yarn download:bin
if ($LASTEXITCODE -ne 0) { Write-Host 'download:bin failed' -ForegroundColor Red; exit 1 }

# ── Local inference backend (ginfer) ──────────────────────────
# GChat has a single local backend: ginfer. Its Windows build has not
# shipped yet (see docs/decisions — ginfer as the sole inference
# backend), so release artifacts do not bundle a backend binary.
Write-Step 'ginfer backend'
Write-Host '  Windows build of ginfer not shipped yet — no backend bundled.' -ForegroundColor Yellow

# ── Build web app ─────────────────────────────────────────────
Write-Step 'yarn build:web'
yarn build:web
if ($LASTEXITCODE -ne 0) { Write-Host 'build:web failed' -ForegroundColor Red; exit 1 }

# ── Generate icons (tauri icon, skip macOS-only Python padding) ─
Write-Step 'Generating icons'
yarn tauri icon ./src-tauri/icons/icon.png
if ($LASTEXITCODE -ne 0) { Write-Host 'tauri icon failed' -ForegroundColor Red; exit 1 }

# Rebuild icon.ico full-bleed from logo-app.png so the taskbar icon isn't shrunk
# by the macOS-style padding tauri icon bakes in. Cosmetic: warn, don't fail.
# Prefer the `py` launcher (avoids the Windows Store python.exe stub).
$pyExe = Get-Command py -ErrorAction SilentlyContinue
if (-not $pyExe) { $pyExe = Get-Command python -ErrorAction SilentlyContinue }
if ($pyExe) {
  & $pyExe.Source scripts/build-windows-app-icon.py
  if ($LASTEXITCODE -ne 0) { Write-Host 'build-windows-app-icon.py failed (taskbar icon may look small)' -ForegroundColor Yellow }
} else {
  Write-Host 'python not found; skipping Windows icon.ico rebuild' -ForegroundColor Yellow
}

# ── Copy assets for Tauri ─────────────────────────────────────
Write-Step 'Copying assets for Tauri'
yarn copy:assets:tauri
if ($LASTEXITCODE -ne 0) { Write-Host 'copy:assets:tauri failed' -ForegroundColor Red; exit 1 }

# ── Build CLI (release) ───────────────────────────────────────
Write-Step 'Build gchat-cli (release)'
if (-not (Test-Path 'src-tauri/resources/bin')) {
    New-Item -ItemType Directory -Path 'src-tauri/resources/bin' -Force | Out-Null
}

Push-Location src-tauri
cargo build --release --features cli --bin gchat-cli
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host 'cargo build gchat-cli failed' -ForegroundColor Red
    exit 1
}
Pop-Location

Copy-Item -Path 'src-tauri/target/release/gchat-cli.exe' -Destination 'src-tauri/resources/bin/gchat-cli.exe' -Force
Write-Host '  CLI built: src-tauri/resources/bin/gchat-cli.exe'

# ── Build Tauri app (NSIS + MSI, no code signing) ─────────────
Write-Step 'Building Tauri app (release, unsigned)'
$env:NODE_OPTIONS = '--max-old-space-size=4196'
yarn tauri build --config src-tauri/tauri.windows.conf.json
if ($LASTEXITCODE -ne 0) {
    Write-Host 'tauri build failed' -ForegroundColor Red
    exit 1
}

# ── Done ──────────────────────────────────────────────────────
Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host '  BUILD COMPLETE!' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''

$nsisDir = 'src-tauri/target/release/bundle/nsis'
if (Test-Path $nsisDir) {
    Write-Host '  NSIS Installer(s):' -ForegroundColor Cyan
    Get-ChildItem -Path $nsisDir -Filter '*.exe' | ForEach-Object {
        Write-Host "    $($_.FullName)" -ForegroundColor White
    }
}

$msiDir = 'src-tauri/target/release/bundle/msi'
if (Test-Path $msiDir) {
    Write-Host '  MSI Installer(s):' -ForegroundColor Cyan
    Get-ChildItem -Path $msiDir -Filter '*.msi' | ForEach-Object {
        Write-Host "    $($_.FullName)" -ForegroundColor White
    }
}

if ($NativeMirror -and $SourceRoot) {
    $sourceOutputRoot = Join-Path $SourceRoot 'out\windows'
    New-Item -ItemType Directory -Path $sourceOutputRoot -Force | Out-Null

    $installers = @()
    if (Test-Path $nsisDir) {
        $installers += Get-ChildItem -Path $nsisDir -Filter '*.exe'
    }
    if (Test-Path $msiDir) {
        $installers += Get-ChildItem -Path $msiDir -Filter '*.msi'
    }
    foreach ($installer in $installers) {
        Copy-Item -Path $installer.FullName -Destination $sourceOutputRoot -Force
    }

    Write-Host ''
    Write-Host '  Copied installer(s) back to:' -ForegroundColor Cyan
    Write-Host "    $sourceOutputRoot" -ForegroundColor White
}

Write-Host ''
