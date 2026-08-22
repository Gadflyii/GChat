#!/usr/bin/env pwsh
# Windows cleanup script for Jan app

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning existing Jan installations..."

# Remove GChat data folders (both regular and nightly)
$gchatAppData = "$env:APPDATA\GChat"
$gchatNightlyAppData = "$env:APPDATA\GChat-nightly"
$gchatLocalAppData = "$env:LOCALAPPDATA\app.gchat"
$gchatNightlyLocalAppData = "$env:LOCALAPPDATA\app.gchat-nightly"

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


# Kill any running GChat processes (both regular and nightly)
Get-Process -Name "GChat" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "gchat" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "GChat-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "gchat-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Jan extensions folder
$janExtensionsPath = "$env:USERPROFILE\jan\extensions"
if (Test-Path $janExtensionsPath) {
    Write-Host "Removing $janExtensionsPath"
    Remove-Item -Path $janExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Jan cleanup completed"
