#Requires -Version 5.1
param(
    [switch]$NativeMirror,
    [string]$SourceRoot,
    [string]$BuildRoot = (Join-Path $env:LOCALAPPDATA 'GChat\windows-build\ginfer-manager'),
    [ValidateRange(1, 32)][int]$Jobs = 4,
    [string]$WslDistribution = 'Ubuntu'
)

$ErrorActionPreference = 'Stop'
$managerProjectRoot = Split-Path -Parent $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
    throw 'Native Windows Rust/MSVC is required. This builder does not install or upgrade tools.'
}
$managerRustHost = @(& rustc.exe -vV | Where-Object { $_ -like 'host:*' }) -join ''
if ($managerRustHost -ne 'host: x86_64-pc-windows-msvc') {
    throw 'This package requires native Windows x86_64 MSVC; cross builds do not qualify the tray runtime.'
}
if ($BuildRoot.StartsWith('\\')) { throw 'The Manager build root must be Windows-local NTFS, not a UNC path.' }
New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
$BuildRoot = (Resolve-Path -LiteralPath $BuildRoot).ProviderPath
$managerLock = $null
try {
    if (-not $NativeMirror) {
        # Own only this candidate's source/target/out. Never replace the accepted
        # GChat native mirror, cache, installers or installed application.
        $managerLock = [System.IO.File]::Open((Join-Path $BuildRoot 'build.lock'),
            [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $managerNativeSource = Join-Path $BuildRoot 'source'
        $managerOwnerPath = Join-Path $BuildRoot 'owner.json'
        if ((Test-Path -LiteralPath $managerNativeSource) -and
            -not (Test-Path -LiteralPath $managerOwnerPath) -and
            @(Get-ChildItem -LiteralPath $managerNativeSource -Force).Count -gt 0) {
            throw 'Refusing to mirror over an unowned Manager source directory.'
        }
        if (Test-Path -LiteralPath $managerOwnerPath) {
            $managerOwner = Get-Content -LiteralPath $managerOwnerPath -Raw | ConvertFrom-Json
            if ($managerOwner.schema -ne 'ginfer-manager-build-v1' -or $managerOwner.source -ne $managerProjectRoot) {
                throw 'This Manager build root belongs to another source candidate. Use a separate -BuildRoot.'
            }
        }
        if ($managerProjectRoot.TrimEnd('\') -eq $managerNativeSource.TrimEnd('\')) {
            throw 'Run the native mirror with -NativeMirror rather than copying it onto itself.'
        }
        @{ schema = 'ginfer-manager-build-v1'; source = $managerProjectRoot } |
            ConvertTo-Json | Set-Content -LiteralPath $managerOwnerPath -Encoding UTF8
        Set-Location ([System.IO.Path]::GetPathRoot($BuildRoot))
        New-Item -ItemType Directory -Path $managerNativeSource -Force | Out-Null
        $managerExcluded = @('.git', '.yarn', '.cache', 'node_modules', 'target',
            'coverage', 'dist', 'build', 'out', 'pre-install', '__pycache__', 'autoqa',
            (Join-Path $managerProjectRoot 'core\lib'),
            (Join-Path $managerProjectRoot 'src-tauri\resources\bin'),
            (Join-Path $managerProjectRoot 'src-tauri\resources\pre-install'))
        # MIR is restricted to the marked source directory while the build lock
        # is held; target/out are siblings and excluded, preserving build evidence.
        $managerCopyArguments = @($managerProjectRoot, $managerNativeSource, '/MIR', '/COPY:DAT', '/DCOPY:DAT', '/R:2', '/W:1',
            '/NFL', '/NDL', '/NP', '/NJH', '/NJS', '/XD') + $managerExcluded + @('/XF', 'node_modules')
        & robocopy.exe @managerCopyArguments
        if ($LASTEXITCODE -gt 7) { throw "Manager source staging failed: robocopy $LASTEXITCODE" }
        $managerNativeScript = Join-Path $managerNativeSource 'scripts\build-ginfer-manager.ps1'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $managerNativeScript -NativeMirror -SourceRoot $managerProjectRoot -BuildRoot $BuildRoot -Jobs $Jobs -WslDistribution $WslDistribution
        if ($LASTEXITCODE -ne 0) { throw "Native Manager build failed: $LASTEXITCODE" }
        return
    }

    $managerGuide = Join-Path $managerProjectRoot 'docs\ginfer-manager\guide.md'
    if (-not (Test-Path -LiteralPath $managerGuide -PathType Leaf)) { throw "Missing operator guide: $managerGuide" }
    Set-Location $managerProjectRoot
    $env:CARGO_TARGET_DIR = Join-Path $BuildRoot 'target'
    $managerOutput = Join-Path $BuildRoot 'out'
    New-Item -ItemType Directory -Path $managerOutput -Force | Out-Null
    $env:CARGO_BUILD_JOBS = $Jobs.ToString()
    $managerPhysicalBytes = [int64](Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize * 1024
    $managerMemoryFloor = [int64][Math]::Max(4GB, $managerPhysicalBytes * 0.125)
    $managerMemoryLog = Join-Path $managerOutput 'memory-guard.jsonl'
    $managerInitialAvailable = [int64](Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory).AvailableBytes
    if ($managerInitialAvailable -lt $managerMemoryFloor) {
        throw 'Windows available memory is already below the Manager guard floor; no compiler was started.'
    }
    $managerCargo = $null
    $managerBuildFinished = $false
    try {
        $managerCargo = Start-Process -FilePath (Get-Command cargo.exe).Source -ArgumentList @(
            'build', '--manifest-path', 'src-tauri/Cargo.toml', '-p', 'ginfer-manager',
            '-p', 'ginfer-host', '--release', '--locked') -WorkingDirectory $managerProjectRoot -NoNewWindow -PassThru
        $managerOwnedStart = $managerCargo.StartTime.ToUniversalTime().ToString('o')
        do {
            $managerSampleTimer = [Diagnostics.Stopwatch]::StartNew()
            $managerAvailable = [int64](Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory).AvailableBytes
            $managerWslRss = @()
            if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
                $managerWslRss = @(& wsl.exe --distribution $WslDistribution --exec ps -eo pid,rss,comm --sort=-rss 2>&1 |
                    Select-Object -First 9 | ForEach-Object { $_.ToString() })
            }
            @{ utc = [DateTime]::UtcNow.ToString('o'); mem_available_bytes = $managerAvailable;
                physical_bytes = $managerPhysicalBytes; floor_bytes = $managerMemoryFloor;
                jobs = $Jobs; cargo_pid = $managerCargo.Id; cargo_start = $managerOwnedStart;
                wsl_distribution = $WslDistribution; wsl_top_rss = $managerWslRss } |
                ConvertTo-Json -Compress | Add-Content -LiteralPath $managerMemoryLog -Encoding UTF8
            if ($managerAvailable -lt $managerMemoryFloor) {
                throw "Windows available memory is below the Manager guard floor ($managerMemoryFloor bytes). Stopping only this build's cargo tree."
            }
            $managerNextSample = [int][Math]::Max(0, 10000 - $managerSampleTimer.ElapsedMilliseconds)
            $managerBuildFinished = $managerCargo.WaitForExit($managerNextSample)
        } while (-not $managerBuildFinished)
        $managerCargo.WaitForExit()
        if ($managerCargo.ExitCode -ne 0) { throw "Manager compilation failed: $($managerCargo.ExitCode)" }
    } finally {
        if ($managerCargo -and -not $managerBuildFinished -and -not $managerCargo.HasExited) {
            # The Process object refers to the exact cargo launched above. Never
            # stop unrelated Rust, WSL, host, GChat or model processes by name.
            & taskkill.exe /PID $managerCargo.Id /T /F | Out-Host
            $managerCargo.WaitForExit()
        }
    }
    Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'release\ginfer-manager.exe') -Destination $managerOutput -Force
    Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'release\ginfer-host.exe') -Destination $managerOutput -Force
    Copy-Item -LiteralPath $managerGuide -Destination (Join-Path $managerOutput 'GUIDE.md') -Force
    Copy-Item -LiteralPath (Join-Path $managerProjectRoot 'web-app\public\fonts\geist\OFL.txt') -Destination (Join-Path $managerOutput 'FONT-LICENSE.txt') -Force
    $managerPackage = Join-Path $managerOutput 'ginfer-manager-windows-x64.zip'
    Compress-Archive -LiteralPath @((Join-Path $managerOutput 'ginfer-manager.exe'),
        (Join-Path $managerOutput 'ginfer-host.exe'), (Join-Path $managerOutput 'GUIDE.md'),
        (Join-Path $managerOutput 'FONT-LICENSE.txt')) -DestinationPath $managerPackage -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath @((Join-Path $managerOutput 'ginfer-manager.exe'),
        (Join-Path $managerOutput 'ginfer-host.exe'), $managerPackage) |
        Select-Object Path, Hash | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $managerOutput 'SHA256SUMS.json') -Encoding UTF8
    @{ source = $SourceRoot; native_source = $managerProjectRoot; target = $env:CARGO_TARGET_DIR;
        package = $managerPackage; cargo = (& cargo.exe --version); rustc = (& rustc.exe --version);
        jobs = $Jobs; memory_floor_bytes = $managerMemoryFloor; memory_log = $managerMemoryLog;
        built_at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $managerOutput 'build-result.json') -Encoding UTF8
    Write-Host "Manager package: $managerPackage"
} finally {
    if ($managerLock) { $managerLock.Dispose() }
}
