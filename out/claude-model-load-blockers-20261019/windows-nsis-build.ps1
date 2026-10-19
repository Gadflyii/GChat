$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$p=[Diagnostics.Process]::GetCurrentProcess();$p.ProcessorAffinity=[IntPtr]0xfff00000L;$p.PriorityClass='BelowNormal'
$r='E:\claude-model-load-blockers-20261019';$src=Join-Path $r 'source';$walk='E:\gchat-walk-20261019';$old='E:\gchat4-windows-rc-250df804a-20261018'
$want='0b3c8860211a8030f25313fdcd732de0a4001cb6'
$env:GIT_CONFIG_COUNT='4';$env:GIT_CONFIG_KEY_0='core.longpaths';$env:GIT_CONFIG_VALUE_0='true'
$env:GIT_CONFIG_KEY_1='core.autocrlf';$env:GIT_CONFIG_VALUE_1='true';$env:GIT_CONFIG_KEY_2='core.filemode';$env:GIT_CONFIG_VALUE_2='false'
$env:GIT_CONFIG_KEY_3='safe.directory';$env:GIT_CONFIG_VALUE_3='\\wsl.localhost\Ubuntu\ai\gchat/.git'
$vs='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
$env:Path='C:\nvm4w\nodejs;C:\Users\Ron\.cargo\bin;C:\Program Files\Git\cmd;'+(Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin')+';'+(Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja')+';'+$env:Path
$env:GCHAT_WINDOWS_BUILD_ROOT=$r
$env:CARGO_HOME=Join-Path $r 'cargo-home'
$env:CARGO_TARGET_DIR=Join-Path $src 'src-tauri\target'
$env:CARGO_BUILD_JOBS='10'
$env:LIBCLANG_PATH=Join-Path $r 'libclang'
$env:PROTOC=Join-Path $r 'build-tools\protoc-29.3\bin\protoc.exe'
$env:YARN_CACHE_FOLDER=Join-Path $r 'yarn-cache';$env:YARN_GLOBAL_FOLDER=Join-Path $r 'yarn-global'
$env:YARN_ENABLE_GLOBAL_CACHE='false';$env:YARN_ENABLE_IMMUTABLE_INSTALLS='false'
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0';$env:COREPACK_DEFAULT_TO_LATEST='0'
$env:HUSKY='0';$env:IS_TAURI='true';$env:TAURI_ENV_PLATFORM='windows';$env:NODE_OPTIONS='--max-old-space-size=4196'
$env:SKIP_BINARIES='1';$env:VSCMD_SKIP_SENDTELEMETRY='1'
Remove-Item Env:VITE_MODEL_CATALOG_URL,Env:IS_DEV,Env:TAURI_SIGNING_PRIVATE_KEY,Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD,Env:TAURI_CONFIG -ErrorAction SilentlyContinue
$env:GCHAT_MICROSOFT_CLIENT_ID='e618bfb1-eb1d-4112-ad84-e3ff963f585c';$env:GCHAT_MICROSOFT_TENANT='common'
function Gate{$a=[int64](Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory).AvailableBytes;if($a -lt 17131606528){throw "Memory preflight refused: $a"};Write-Output "MEMORY_OK $a"}
$git=(Get-Command git.exe).Source
Gate
if(-not(Test-Path -LiteralPath $src)){& $git clone --no-local --single-branch --branch fix/claude-model-load-blockers-20261019 '\\wsl.localhost\Ubuntu\ai\gchat' $src}
if((& $git -C $src rev-parse HEAD).Trim() -ne $want){throw 'Source pin mismatch'}
$copies=@(
 @("$walk\cargo-home",(Join-Path $r 'cargo-home'),$null),
 @("$walk\source\src-tauri\target\release",(Join-Path $src 'src-tauri\target\release'),"$walk\source\src-tauri\target\release\bundle"),
 @("$walk\yarn-cache",(Join-Path $r 'yarn-cache'),$null),
 @("$walk\yarn-global",(Join-Path $r 'yarn-global'),$null),
 @("$walk\build-tools\protoc-29.3",(Join-Path $r 'build-tools\protoc-29.3'),$null),
 @("$walk\libclang",(Join-Path $r 'libclang'),$null),
 @("$walk\source\node_modules",(Join-Path $src 'node_modules'),$null),
 @("$walk\source\.yarn",(Join-Path $src '.yarn'),$null),
 @("$walk\source\src-tauri\plugins\node_modules",(Join-Path $src 'src-tauri\plugins\node_modules'),$null),
 @("$walk\source\src-tauri\plugins\.yarn",(Join-Path $src 'src-tauri\plugins\.yarn'),$null)
)
foreach($c in $copies){
 Gate
 $a=@($c[0],$c[1],'/E','/COPY:DAT','/DCOPY:DAT','/R:2','/W:1','/XJ','/NFL','/NDL','/NP','/NJH','/NJS','/MT:8')
 if($c[2]){$a+=@('/XD',$c[2])}
 & robocopy.exe @a | Out-Null
 if($LASTEXITCODE -gt 7){throw "Donor copy failed $LASTEXITCODE : $($c[0])"}
 Write-Output "COPIED $($c[0])"
}
$bin=Join-Path $src 'src-tauri\resources\bin';New-Item -ItemType Directory -Path $bin -Force|Out-Null
& robocopy.exe "$walk\source\src-tauri\resources\bin" $bin bun.exe bun-x86_64-pc-windows-msvc.exe uv.exe uv-x86_64-pc-windows-msvc.exe sqlite-vec.dll /COPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH /NJS | Out-Null
if($LASTEXITCODE -gt 7){throw 'Sidecar copy failed'}
$vcvars=Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
& cmd.exe /d /s /c ('"'+$vcvars+'" >nul && set') | ForEach-Object {if($_-match'^([^=]+)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}}
Set-Location $src
$catalogs=(Get-ChildItem -LiteralPath "$walk\profile-catalogs-new" -Filter 'windows-*.json' -File|Sort-Object Name|ForEach-Object{$_.FullName})-join';'
$archives="$old\engine\source\out\windows\ginfer-windows-x64-sm86.zip;$old\engine\source\out\windows\ginfer-windows-x64-sm89.zip;$old\engine\source\out\windows\ginfer-windows-x64-sm120a.zip"
Gate
& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $src 'scripts\build-windows-release.ps1') -NativeMirror -PreparedEnvironment -GinferRuntimeArchives $archives -GinferSourceCommit 6b85ecf77da129fe332818b8bcaec9467b56bdaa -GinferProfileCatalogs $catalogs -GbotCuaRuntime (Join-Path $walk 'inputs\windows-cua-runtime')
if($LASTEXITCODE -ne 0){throw "Release builder failed $LASTEXITCODE"}
$path=Join-Path $src 'src-tauri\target\release\bundle\nsis\GChat_2.0.42_x64-setup.exe'
if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing package $path"}
$f=Get-Item -LiteralPath $path
@{status='PASS';source_commit=$want;engine_commit='6b85ecf77da129fe332818b8bcaec9467b56bdaa';nsis=@{path=$path;bytes=$f.Length;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $r 'result.json') -Encoding UTF8
Write-Output 'MODEL_LOAD_WINDOWS_BUILD PASS'
