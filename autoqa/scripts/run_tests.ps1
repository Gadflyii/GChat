#!/usr/bin/env pwsh
# Windows test runner script

param(
    [string]$GChatAppPath,
    [string]$ProcessName,
    [string]$RpToken
)

Write-Host "Starting Auto QA Tests..."

Write-Host "Jan app path: $GChatAppPath"
Write-Host "Process name: $ProcessName"
Write-Host "Current working directory: $(Get-Location)"
Write-Host "Contents of current directory:"
Get-ChildItem
Write-Host "Contents of trajectories directory (if exists):"
if (Test-Path "trajectories") {
    Get-ChildItem "trajectories"
} else {
    Write-Host "trajectories directory not found"
}

# Run the main test with proper arguments
if ($GChatAppPath -and $ProcessName) {
    python main.py --enable-reportportal --rp-token "$RpToken" --gchat-app-path "$GChatAppPath" --gchat-process-name "$ProcessName"
} elseif ($GChatAppPath) {
    python main.py --enable-reportportal --rp-token "$RpToken" --gchat-app-path "$GChatAppPath"
} else {
    python main.py --enable-reportportal --rp-token "$RpToken"
}
