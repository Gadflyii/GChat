#Requires -Version 5.1
# scripts/dev-windows.ps1
# GChat - Windows development launcher
# Mirrors CI pipeline: install deps, build CLI, run dev
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/dev-windows.ps1
#   - or -
#   make dev-windows
#
# Flags:
#   -SkipBackendDownload  Retained for compatibility with `make dev-windows-fast`.
#                         GChat has a single local backend (ginfer) and its
#                         Windows build has not shipped yet, so there is
#                         currently nothing to download or skip.

param(
    [switch]$SkipBackendDownload
)

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot | Split-Path
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
        Write-Host 'Run: make setup-windows' -ForegroundColor Yellow
        exit 1
    }
}

# ── Ensure nvm + Node.js are available ────────────────────────
Write-Step 'Ensuring nvm + Node.js are available'
Refresh-SessionPath

# Ensure NVM_HOME is set
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

# Add nvm to PATH if missing
if ((Test-Path $env:NVM_HOME) -and ($env:Path -notlike "*$($env:NVM_HOME)*")) {
    $env:Path = $env:NVM_HOME + ';' + $env:Path
}
if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
    $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
}

# Ensure settings.txt exists
$settingsFile = Join-Path $env:NVM_HOME 'settings.txt'
if ((Test-Path $env:NVM_HOME) -and (-not (Test-Path $settingsFile))) {
    Write-Host "  Creating nvm settings.txt..."
    $settingsContent = "root: $($env:NVM_HOME)`r`npath: $($env:NVM_SYMLINK)"
    [System.IO.File]::WriteAllText($settingsFile, $settingsContent)
}

# Install + activate Node.js 20 via nvm if node is missing
if (-not (Test-Cmd 'node')) {
    if (Test-Cmd 'nvm') {
        Write-Host '  Node.js not found. Installing Node.js 20 via nvm...'
        nvm install 20
        nvm use 20
        Refresh-SessionPath
        # Re-add symlink to PATH after nvm use
        if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
            $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
        }
    }
}

# Setup yarn via corepack (yarn 4.5.3 as declared in package.json)
if (Test-Cmd 'node') {
    # Use a dedicated writable directory for corepack shims
    # (nvm's node dir often has EPERM issues with corepack enable)
    $corepackBin = Join-Path $env:USERPROFILE '.corepack\bin'
    if (-not (Test-Path $corepackBin)) {
        New-Item -ItemType Directory -Path $corepackBin -Force | Out-Null
    }

    # Remove npm-global yarn v1 if present — it conflicts with corepack
    $npmPrefix = ((npm prefix -g 2>&1) | Out-String).Trim()
    $npmYarn = Join-Path $npmPrefix 'yarn.cmd'
    if (Test-Path $npmYarn) {
        Write-Host '  Removing conflicting npm-global yarn v1...'
        npm uninstall -g yarn 2>&1 | Out-Null
    }

    # Enable corepack shims in our writable directory
    Write-Host "  Enabling corepack (shim dir: $corepackBin)..."
    corepack enable --install-directory $corepackBin
    corepack prepare yarn@4.5.3 --activate

    # Add shim directory to PATH
    if ($env:Path -notlike "*$corepackBin*") {
        $env:Path = $corepackBin + ';' + $env:Path
    }
}

# Ensure cargo is on PATH
$cargoPath = Join-Path $env:USERPROFILE '.cargo\bin'
if ((Test-Path $cargoPath) -and ($env:Path -notlike "*\.cargo\bin*")) {
    $env:Path = $cargoPath + ';' + $env:Path
}

# ── Preflight checks ─────────────────────────────────────────
Write-Step 'Preflight checks'
Assert-Cmd 'node'   'Install via: nvm install 20 && nvm use 20'
Assert-Cmd 'cargo'  'Install via: make setup-windows (installs Rust)'

# Yarn check: search .cmd shim in known locations if not on PATH
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

# ── Download binaries (bun, uv, sqlite-vec) ───────────────────
Write-Step 'yarn download:bin'
yarn download:bin
if ($LASTEXITCODE -ne 0) { Write-Host 'download:bin failed' -ForegroundColor Red; exit 1 }

# ── Local inference backend (ginfer) ──────────────────────────
# GChat has a single local backend: ginfer. Its Windows build has not
# shipped yet (see docs/decisions — ginfer as the sole inference backend),
# so there is no backend binary to pre-download. The app still launches;
# its NVIDIA hardware gate surfaces local inference as unsupported until
# the ginfer Windows port lands.
Write-Step 'ginfer backend'
Write-Host '  Windows build of ginfer not shipped yet — nothing to download.' -ForegroundColor Yellow
Write-Host '  The app will report local inference as unsupported on this host.'

# ── Build CLI (debug) ─────────────────────────────────────────
Write-Step 'Build gchat-cli (debug)'
$cliBin = 'src-tauri/resources/bin/gchat-cli.exe'
if (-not (Test-Path 'src-tauri/resources/bin')) {
    New-Item -ItemType Directory -Path 'src-tauri/resources/bin' -Force | Out-Null
}

Push-Location src-tauri
cargo build --features cli --bin gchat-cli
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host 'cargo build gchat-cli failed' -ForegroundColor Red
    exit 1
}
Pop-Location

Copy-Item -Path 'src-tauri/target/debug/gchat-cli.exe' -Destination $cliBin -Force
Write-Host "  CLI built: $cliBin"

# ── Generate icons (tauri icon, skip macOS-only Python padding) ─
Write-Step 'Generating icons (tauri icon)'
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

# ── Copy assets for Tauri ──────────────────────────────────────
Write-Step 'Copying assets for Tauri'
yarn copy:assets:tauri
if ($LASTEXITCODE -ne 0) { Write-Host 'copy:assets:tauri failed' -ForegroundColor Red; exit 1 }

# ── Launch dev server ──────────────────────────────────────────
Write-Step 'Starting dev server (tauri dev)'
$env:IS_CLEAN = 'true'
# Force IPv4 to avoid localhost→::1 mismatch between Vite and Tauri on Windows
$env:TAURI_DEV_HOST = '127.0.0.1'
yarn tauri dev --config '{\"build\":{\"devUrl\":\"http://127.0.0.1:1420\"}}'
