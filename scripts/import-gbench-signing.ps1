# Load local release credentials into the build process, never its source mirror.
function Import-GbenchSigning {
    param([string]$Path = (Join-Path $env:LOCALAPPDATA 'GChat\build-secrets\gbench-signing.env'))
    if (-not $env:GBENCH_SIGNING_KEY_ID -and -not $env:GBENCH_SIGNING_SEED_HEX) {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            Write-Host '  G.bench signing not configured; this build cannot publish results.'
            return
        }
        $values = @{}
        foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
            if (-not $line.Trim()) { continue }
            if ($line -notmatch '^(GBENCH_SIGNING_KEY_ID|GBENCH_SIGNING_SEED_HEX)=(.+)$' -or $values.ContainsKey($Matches[1])) {
                throw 'Invalid G.bench signing file. Expected exactly one key ID and seed.'
            }
            $values[$Matches[1]] = $Matches[2]
        }
        if ($values.Count -ne 2 -or $values['GBENCH_SIGNING_KEY_ID'] -cnotmatch '^[a-zA-Z0-9_-]{1,64}$' -or
            $values['GBENCH_SIGNING_SEED_HEX'] -cnotmatch '^[a-f0-9]{64}$') {
            throw 'Invalid G.bench signing file. Expected a valid key ID and 32-byte seed.'
        }
        $env:GBENCH_SIGNING_KEY_ID = $values['GBENCH_SIGNING_KEY_ID']
        $env:GBENCH_SIGNING_SEED_HEX = $values['GBENCH_SIGNING_SEED_HEX']
    }
    if ($env:GBENCH_SIGNING_KEY_ID -cnotmatch '^[a-zA-Z0-9_-]{1,64}$' -or
        $env:GBENCH_SIGNING_SEED_HEX -cnotmatch '^[a-f0-9]{64}$') {
        throw 'G.bench build credentials are incomplete or invalid.'
    }
    Write-Host "  G.bench signing configured: $env:GBENCH_SIGNING_KEY_ID"
}
