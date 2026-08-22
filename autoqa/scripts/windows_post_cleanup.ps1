#!/usr/bin/env pwsh
# Windows post-test cleanup script

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning up after tests..."

# Kill any running GChat processes (both regular and nightly)
Get-Process -Name "GChat" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "gchat" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "GChat-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "gchat-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove GChat data folders (both regular and nightly)
$gchatAppData = "$env:APPDATA\GChat"
$gchatNightlyAppData = "$env:APPDATA\GChat-nightly"
$gchatLocalAppData = "$env:LOCALAPPDATA\app.gchat"
$gchatNightlyLocalAppData = "$env:LOCALAPPDATA\app.gchat-nightly"
$gchatProgramsPath = "$env:LOCALAPPDATA\Programs\gchat"
$gchatNightlyProgramsPath = "$env:LOCALAPPDATA\Programs\gchat-nightly"

if (Test-Path $gchatAppData) {
    Write-Host "Removing $gchatAppData"
    Remove-Item -Path $gchatAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $gchatNightlyAppData) {
    Write-Host "Removing $gchatNightlyAppData"
    Remove-Item -Path $gchatNightlyAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $gchatLocalAppData) {
    Write-Host "Removing $gchatLocalAppData"
    Remove-Item -Path $gchatLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $gchatNightlyLocalAppData) {
    Write-Host "Removing $gchatNightlyLocalAppData"
    Remove-Item -Path $gchatNightlyLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $gchatProgramsPath) {
    Write-Host "Removing $gchatProgramsPath"
    Remove-Item -Path $gchatProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $gchatNightlyProgramsPath) {
    Write-Host "Removing $gchatNightlyProgramsPath"
    Remove-Item -Path $gchatNightlyProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove GChat extensions folder
$gchatExtensionsPath = "$env:USERPROFILE\gchat\extensions"
if (Test-Path $gchatExtensionsPath) {
    Write-Host "Removing $gchatExtensionsPath"
    Remove-Item -Path $gchatExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Try to uninstall GChat app silently
try {
    $isNightly = [System.Convert]::ToBoolean($IsNightly)

    # Determine uninstaller path based on nightly flag
    if ($isNightly) {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\gchat-nightly\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\gchat-nightly"
    } else {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\gchat\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\gchat"
    }

    Write-Host "Looking for uninstaller at: $uninstallerPath"

    if (Test-Path $uninstallerPath) {
        Write-Host "Found uninstaller, attempting silent uninstall..."
        Start-Process -FilePath $uninstallerPath -ArgumentList "/S" -Wait -NoNewWindow -ErrorAction SilentlyContinue
        Write-Host "Uninstall completed"
    } else {
        Write-Host "No uninstaller found, attempting manual cleanup..."

        if (Test-Path $installPath) {
            Write-Host "Removing installation directory: $installPath"
            Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "GChat app cleanup completed"
}
catch {
    Write-Warning "Failed to uninstall GChat app cleanly: $_"
    Write-Host "Manual cleanup may be required"
}

# Clean up downloaded installer
$installerPath = "$env:TEMP\gchat-installer.exe"
if (Test-Path $installerPath) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Cleanup completed"
