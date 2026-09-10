#Requires -Version 5.1
param([Parameter(Mandatory)][string]$Binary, [switch]$Pipeline)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Binary = (Get-Item -LiteralPath $Binary).FullName
$root = Join-Path ([IO.Path]::GetTempPath()) ('gchat-host-test-' + [Guid]::NewGuid().ToString('N'))
$provider = Join-Path $root 'provider'
$state = Join-Path $provider 'host'
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
New-Item -ItemType Directory -Path $root | Out-Null
$arguments = @('--ensure-running', '--data-dir', $state, '--desktop-provider', $provider,
    '--engine', (Join-Path $root 'not-installed\ginfer-serve.exe'),
    '--listen', "127.0.0.1:$port")
function Snapshot {
    $quoted = @($arguments | ForEach-Object { '"' + $_ + '"' })
    $client = New-Object Diagnostics.Process
    $client.StartInfo.FileName = $Binary
    $client.StartInfo.Arguments = $quoted -join ' '
    if ($Pipeline) {
        $literal = @(@($Binary) + $arguments | ForEach-Object { "'" + $_.Replace("'", "''") + "'" })
        $command = '& ' + ($literal -join ' ') + ' | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 30; exit $LASTEXITCODE'
        $client.StartInfo.FileName = Join-Path $PSHOME 'powershell.exe'
        $client.StartInfo.Arguments = '-NoProfile -NonInteractive -EncodedCommand ' +
            [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    }
    $client.StartInfo.UseShellExecute = $false
    $client.StartInfo.RedirectStandardOutput = $true
    $client.StartInfo.RedirectStandardError = $true
    $client.StartInfo.CreateNoWindow = $true
    try {
        [void]$client.Start()
        if (-not $client.WaitForExit(40000)) {
            $client.Kill()
            throw 'Bootstrap client did not exit within 40 seconds'
        }
        if ($client.ExitCode -ne 0) { throw ('Bootstrap failed: ' + $client.StandardError.ReadLine()) }
        return ($client.StandardOutput.ReadLine() | ConvertFrom-Json)
    } finally {
        $client.Dispose()
    }
}
try {
    $first = Snapshot
    $second = Snapshot
    if ($first.boot_id -ne $second.boot_id) { throw 'Reconnect started a different owner' }
    if (@($first.gpus).Count -eq 0) { throw 'No real NVIDIA inventory returned' }
    if (-not (Test-Path -LiteralPath (Join-Path $provider 'models') -PathType Container)) {
        throw 'Desktop model cache was not created'
    }
    $private = Get-Content -LiteralPath (Join-Path $state 'host.json') -Raw | ConvertFrom-Json
    if ($private.management_origin -ne "https://127.0.0.1:$port") { throw 'Wrong published origin' }
    $public = $second | ConvertTo-Json -Depth 30
    if ($public.Contains($private.pairing_admin_token)) { throw 'Snapshot exposed management credential' }
    $socket = New-Object Net.Sockets.TcpClient
    try { $socket.Connect('127.0.0.1', $port) } finally { $socket.Dispose() }
    Write-Output ('PASS: Windows host reconnect, persistent lifetime, desktop cache and inventory (' +
        (@($first.gpus | ForEach-Object { $_.name }) -join ', ') + '); no inference loaded.')
} finally {
    # Only children whose executable and unique test state path both match are ours.
    $owners = @(Get-CimInstance Win32_Process -Filter "Name = 'ginfer-host.exe'" |
        Where-Object { $_.ExecutablePath -eq $Binary -and $_.CommandLine -and $_.CommandLine.Contains($state) })
    foreach ($owner in $owners) {
        Stop-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue
        Wait-Process -Id $owner.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $root -Recurse -Force
}
