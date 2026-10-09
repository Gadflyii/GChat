# Adapted from out/oi056-current-engine/host-request.ps1. Execution needs a booked
# native window. This helper never starts or reloads an Engine or changes a profile.
param(
 [ValidateSet('Request','PrepareC4','RunC4')][string]$Mode='Request',
 [string]$Path='/host/v1/snapshot', [string]$BodyFile,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [string]$OutputName='snapshot.json', [string]$EngineOrigin,
 [string]$ApiKey='', [string[]]$BodyFiles, [string]$RequestLogJsonl,
 [int]$EngineProcessId, [string]$ExpectedEnginePath,
 [string]$CorpusFile=(Join-Path $PSScriptRoot 'muse-qualified-context-bank.json')
)
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'RON-9950X3D2'){throw 'Wrong workstation'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$gpu='GPU-92a61cb1-6b5e-cc7b-b669-72b2662d9d6e'
$deadlineMs=600000 # Retained matched wave: 199.45 seconds; not the old 180s ceiling.
$model='muse-glimmer-30b/nvfp4-dflash-nvfp4'
$utf8=New-Object System.Text.UTF8Encoding($false)
function Save-Json($name,$value){
 [IO.File]::WriteAllText((Join-Path $OutputDirectory $name),($value|ConvertTo-Json -Depth 40),$utf8)
}
if(-not ('C4HostRequest' -as [type])){Add-Type @'
using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
public static class C4HostRequest {
 static HttpWebRequest[] wave;
 static volatile bool cancelled;
 public static string Call(string origin,byte[] cert,string token,string path,string body,int timeout) {
  var r=(HttpWebRequest)WebRequest.Create(origin+path);
  r.Timeout=timeout; r.ReadWriteTimeout=timeout;
  if(cert!=null)r.ServerCertificateValidationCallback=(_,c,chain,errors)=>c!=null && c.GetRawCertData().SequenceEqual(cert);
  if(!String.IsNullOrEmpty(token))r.Headers["Authorization"]="Bearer "+token;
  r.Method=String.IsNullOrEmpty(body)?"GET":"POST";
  if(!String.IsNullOrEmpty(body)){var b=Encoding.UTF8.GetBytes(body);r.ContentType="application/json";r.ContentLength=b.Length;using(var s=r.GetRequestStream())s.Write(b,0,b.Length);}
  try {using(var response=r.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))return reader.ReadToEnd();}
  catch(WebException e){if(e.Response==null)throw;using(var reader=new StreamReader(e.Response.GetResponseStream()))throw new Exception(reader.ReadToEnd(),e);}
 }
 public static Task<string>[] Four(string origin,string token,string[] bodies,int timeout){
  ServicePointManager.DefaultConnectionLimit=16;
  var gate=new ManualResetEventSlim(false);
  cancelled=false;
  wave=new HttpWebRequest[4];
  var tasks=Enumerable.Range(0,4).Select(i=>Task.Factory.StartNew(()=>{
   var r=(HttpWebRequest)WebRequest.Create(origin+"/v1/chat/completions");
   r.Timeout=timeout;r.ReadWriteTimeout=timeout;r.Method="POST";r.ContentType="application/json";
   if(!String.IsNullOrEmpty(token))r.Headers["Authorization"]="Bearer "+token;
   var b=Encoding.UTF8.GetBytes(bodies[i]);r.ContentLength=b.Length;wave[i]=r;
   gate.Wait();
   if(cancelled)r.Abort();
   using(var s=r.GetRequestStream())s.Write(b,0,b.Length);
   try {using(var response=r.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))return reader.ReadToEnd();}
   catch(WebException e){if(e.Response==null)throw;using(var reader=new StreamReader(e.Response.GetResponseStream()))throw new Exception(reader.ReadToEnd(),e);}
  },CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default)).ToArray();
  gate.Set();return tasks;
 }
 public static void AbortFour(){cancelled=true;if(wave!=null)foreach(var r in wave)if(r!=null)r.Abort();}
}
'@
}
if($Mode -eq 'Request'){
 # Original pinned local Host control transport; lifecycle bodies must carry the
 # expected_session_id when stopping/restarting/reloading an assigned instance.
 $data=(Get-Content (Join-Path $env:APPDATA 'GChat\settings.json') -Raw|ConvertFrom-Json).data_folder
 $state=Get-Content (Join-Path $data 'ginfer\host\host.json') -Raw|ConvertFrom-Json
 if($state.management_origin -ne 'https://127.0.0.1:7443'){throw 'Unexpected local Host origin'}
 $body=if($BodyFile){Get-Content -LiteralPath $BodyFile -Raw}else{$null}
 if($Path -match '^/host/v1/instances/[^/]+/(stop|restart|reload)$'){
  if(!$body -or 'expected_session_id' -notin @(($body|ConvertFrom-Json).PSObject.Properties.Name)){throw 'Assigned Host lifecycle needs expected_session_id'}
 }
 $timeout=if($Path -match '^/host/v1/instances/[^/]+/(start|stop|restart|reload)$'){$deadlineMs}else{30000}
 $result=[C4HostRequest]::Call($state.management_origin,[byte[]]$state.certificate.certificate_der,$state.pairing_admin_token,$Path,$body,$timeout)|ConvertFrom-Json
 Save-Json $OutputName $result
 return
}
$uri=[Uri]$EngineOrigin
if($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.UserInfo){throw 'Direct capacity check requires a native HTTP loopback origin'}
$EngineOrigin=$EngineOrigin.TrimEnd('/')
function Count-Body([string]$body,[int]$timeout=60000){
 $value=[C4HostRequest]::Call($EngineOrigin,$null,$ApiKey,'/v1/chat/completions/count_tokens',$body,$timeout)|ConvertFrom-Json
 if($value.object -ne 'chat.completion.token_count' -or $null -eq $value.input_tokens){throw 'Unexpected public count response'}
 return [int]$value.input_tokens
}
function Make-Body([string]$content){
 # Omitted reasoning/sampling/stop fields retain the loaded public defaults.
 return (@{model=$model;messages=@(@{role='user';content=$content});max_tokens=64;stream=$false}|ConvertTo-Json -Depth 8 -Compress)
}
if($Mode -eq 'PrepareC4'){
 $bank=([IO.File]::ReadAllText($CorpusFile)|ConvertFrom-Json).text
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($bank)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($hash -ne '651de97233bd1f43ba486fe8653a0cd0b4f0e342e684e1c30f836c8334916af1'){throw 'Retained qualification source-bank mismatch'}
 $timer=[Diagnostics.Stopwatch]::StartNew();$manifest=@()
 foreach($lane in 0..3){
  $marker=@('Alpha','Beta','Gamma','Delta')[$lane]+" lane $lane`n"
  $text=$bank;$calls=0;$exact=$null
  # Bracket, then bisect text length; every observation comes from the full
  # public request template. No one-character/one-token assumption is made.
  while($true){
   if(++$calls -gt 96 -or $timer.ElapsedMilliseconds -ge $deadlineMs){throw 'Bounded exact-count preparation exhausted'}
   $body=Make-Body ($marker+$text)
   $count=Count-Body $body ([Math]::Min(60000,$deadlineMs-[int]$timer.ElapsedMilliseconds))
   if($count -eq 131009){$exact=$body;break}
   if($count -gt 131009){break}
   $text+=$text
   if($text.Length -gt 4194304){throw 'Source text bracket exceeded 4MiB'}
  }
  $low=0;$high=$text.Length
  while($null -eq $exact -and $high-$low -gt 1){
   $middle=[int][Math]::Floor(($low+$high)/2)
   if(++$calls -gt 96 -or $timer.ElapsedMilliseconds -ge $deadlineMs){throw 'Bounded exact-count preparation exhausted'}
   $body=Make-Body ($marker+$text.Substring(0,$middle))
   $count=Count-Body $body ([Math]::Min(60000,$deadlineMs-[int]$timer.ElapsedMilliseconds))
   if($count -eq 131009){$exact=$body;break}
   if($count -lt 131009){$low=$middle}else{$high=$middle}
  }
  # BPE boundaries can make a local character count non-monotonic. Inspect a
  # bounded nearby range and refuse a different token length if it cannot fit.
  if($null -eq $exact){
   foreach($length in ([Math]::Max(0,$low-24))..([Math]::Min($text.Length,$high+24))){
    if(++$calls -gt 96 -or $timer.ElapsedMilliseconds -ge $deadlineMs){throw 'Bounded exact-count preparation exhausted'}
    $body=Make-Body ($marker+$text.Substring(0,$length))
    if((Count-Body $body ([Math]::Min(60000,$deadlineMs-[int]$timer.ElapsedMilliseconds))) -eq 131009){$exact=$body;break}
   }
  }
  if($null -eq $exact){throw 'Could not represent exactly 131009 public input tokens in bounded preparation'}
  $file="c4-lane-$lane.json";[IO.File]::WriteAllText((Join-Path $OutputDirectory $file),$exact,$utf8)
  $manifest+=@{lane=$lane;body_file=$file;input_tokens=131009;role='user';early_marker=$marker;count_calls=$calls;requested_outputs=64}
 }
 Save-Json 'c4-inputs.json' @{scope='Retained source-bank text with distinct early lane markers; public defaults; capacity control, not model-quality qualification';source_bank_sha256=$hash;requests=$manifest;elapsed_seconds=$timer.Elapsed.TotalSeconds}
 return
}
# RunC4 is a distinct direct public-Engine capacity check. The coordinator owns
# launch/normal cleanup, followed by supported Host restoration to stopped state.
if(@($BodyFiles).Count -ne 4 -or !$RequestLogJsonl -or !$EngineProcessId -or !$ExpectedEnginePath){throw 'RunC4 requires four bodies, request JSONL, exact owned PID and executable path'}
$owned=Get-Process -Id $EngineProcessId
if($owned.Path -ne $ExpectedEnginePath -or $owned.ProcessName -ne 'ginfer-serve'){throw 'Direct Engine process ownership mismatch'}
$ownedStart=$owned.StartTime.ToUniversalTime()
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort $uri.Port|Where-Object{$_.LocalAddress -eq '127.0.0.1'})
if($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $EngineProcessId){throw 'Owned direct Engine PID does not own the loopback listener'}
function Read-Events{
 $stream=New-Object IO.FileStream($RequestLogJsonl,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $reader=New-Object IO.StreamReader($stream)
 try{$raw=$reader.ReadToEnd()}finally{$reader.Dispose()}
 # A concurrently written final partial line is not a complete event.
 $lines=$raw -split "`n";if($lines.Count -lt 2){return}
 foreach($line in $lines[0..($lines.Count-2)]){if($line.Trim()){$line|ConvertFrom-Json}}
}
$events=@(Read-Events);$starts=@($events|Where-Object{$_.event -eq 'server_start' -and $_.server.port -eq $uri.Port})
if($starts.Count -ne 1){throw 'Require one exact server_start event for the owned loopback process'}
if(@($events|Where-Object{$_.event -in @('request_start','request_done','request_error')}).Count){throw 'Matched cold cohort requires a fresh direct Engine without prior inference'}
$start=$starts[0];$e=$start.engine
if($start.timestamp_unix_ms -lt ([DateTimeOffset]$ownedStart).ToUnixTimeMilliseconds()){throw 'Diagnostic server_start predates the assigned process'}
# JSONL records resolved Engine policy. Muse AUTO can become adaptive/15 or
# calibrated fixed families; compare requested CLI flags separately.
function Require-Argument([string]$name,[string]$value){
 $indices=@(0..($start.argv.Count-1)|Where-Object{$start.argv[$_] -eq $name})
 if($indices.Count -ne 1 -or $indices[0]+1 -ge $start.argv.Count -or $start.argv[$indices[0]+1] -ne $value){throw "Requested startup argument differs: $name"}
}
foreach($pair in @(@('--host','127.0.0.1'),@('--port',[string]$uri.Port),@('--model-id',$model),@('--tp','1'),@('--max-context','131072'),@('--max-concurrency','4'),@('--spec','dflash'),@('--draft-policy','auto'),@('--draft-tokens','4'),@('--draft-tp','1'),@('--kv-dtype','nvfp4'),@('--kv-arena-headroom-bytes','314572800'),@('--prefill-chunk','1024'))){Require-Argument $pair[0] $pair[1]}
Require-Argument '--request-log-jsonl' $RequestLogJsonl
if(@($start.argv|Where-Object{$_ -in @('--kv-arena-bytes','--vision','--no-cuda-graph','--no-prefix-reuse')}).Count){throw 'Startup flags changed automatic pool/text/graphs/prefix behavior'}
if($e.tensor_parallel_size -ne 1 -or $e.draft_tensor_parallel_size -ne 1 -or $e.max_context -ne 131072 -or $e.max_concurrency -ne 4 -or $e.kv_arena_mode -ne 'auto_max' -or $e.kv_arena_headroom_bytes -ne 314572800 -or $e.host_kv_cache_bytes_per_rank -ne 0 -or $e.prefill_chunk -ne 1024 -or $e.kv_cache -ne 'nvfp4-group16' -or $e.vision -or !$e.cuda_graph -or !$e.prefix_reuse -or $e.speculative_backend -ne 'dflash'){throw 'Direct Engine effective options differ from the pending C4 profile'}
if($e.speculative_width_policy -notin @('adaptive','fixed') -or $e.speculative_draft_window -lt 1 -or $e.speculative_draft_window -gt 15){throw 'Resolved Muse draft geometry outside the frozen target implementation'}
if($start.server.public_model_id -ne $model){throw 'Direct launch must supply the explicit capacity-check public model ID with --model-id'}
if($start.artifact.model_id -ne 'muse-glimmer-30b' -or $start.artifact.weights_id -ne 'nvfp4-dflash-nvfp4' -or $start.artifact.size_bytes -ne 22447498752 -or @($start.environment.gpus).Count -ne 1 -or $start.environment.gpus[0].gpu_uuid -ne $gpu){throw 'Direct Engine artifact/GPU mismatch'}
if($start.memory.kv_arena_bytes_per_rank -lt 2550407168 -or $start.memory.kv_arena_segment_capacity -lt 268){throw 'Measured startup arena/slots cannot satisfy the calculated cold C4 requirement'}
$bodies=@($BodyFiles|ForEach-Object{[IO.File]::ReadAllText($_)})
if(@($bodies|Select-Object -Unique).Count -ne 4){throw 'Four independent request bodies required'}
for($lane=0;$lane -lt 4;$lane++){
 $body=$bodies[$lane]
 $j=$body|ConvertFrom-Json
 if($j.model -ne $model -or $j.max_tokens -ne 64 -or $j.stream -or @($j.messages).Count -ne 1 -or $j.messages[0].role -ne 'user'){throw 'Matched public request shape differs'}
 if(@($j.PSObject.Properties.Name|Where-Object{$_ -notin @('model','max_tokens','stream','messages')}).Count){throw 'Preserve omitted sampling, stop and reasoning defaults'}
 $marker=@('Alpha','Beta','Gamma','Delta')[$lane]+" lane $lane`n"
 if(!$j.messages[0].content.StartsWith($marker,[StringComparison]::Ordinal)){throw 'Request bodies must diverge at the early lane marker'}
 if((Count-Body $body) -ne 131009){throw 'Public input token count changed'}
}
$smi=(Get-Command nvidia-smi.exe -ErrorAction Stop).Source
$samples=@();$responses=@();$failure=$null;$cleanup=$null
$waveStart=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$timer=[Diagnostics.Stopwatch]::StartNew()
try{
 $tasks=[C4HostRequest]::Four($EngineOrigin,$ApiKey,[string[]]$bodies,$deadlineMs)
 do{
  if($timer.ElapsedMilliseconds -ge $deadlineMs){throw '600-second concurrent wave deadline exceeded'}
  if(@($tasks|Where-Object{$_.IsFaulted -or $_.IsCanceled}).Count){throw 'At least one public request failed'}
  $row=& $smi "--id=$gpu" '--query-gpu=uuid,memory.free' '--format=csv,noheader,nounits'
  if($LASTEXITCODE -ne 0){throw 'GPU memory sample failed'}
  $parts=$row.Trim() -split ',\s*';if($parts.Count -ne 2 -or $parts[0] -ne $gpu){throw 'GPU sample identity mismatch'}
  $free=[int64]$parts[1];$samples+=@{seconds=$timer.Elapsed.TotalSeconds;gpu_uuid=$gpu;free_mib=$free}
  if($free -lt 300){throw 'Sampled physical free memory below the unchanged 300MiB guard'}
  Start-Sleep -Milliseconds 250
 }while(@($tasks|Where-Object{-not $_.IsCompleted}).Count)
 foreach($task in $tasks){$responses+=($task.GetAwaiter().GetResult()|ConvertFrom-Json)}
 foreach($response in $responses){
  if($response.usage.prompt_tokens -ne 131009 -or $response.usage.completion_tokens -ne 64){throw 'Matched full-context control incomplete (including possible early EOS); no forced-output retry'}
 }
 # Allow the normal reporter to publish the completed idle interval, bounded 5s.
 $reportWait=[Diagnostics.Stopwatch]::StartNew()
 do{
  $wave=@(Read-Events|Where-Object{$_.server_instance_id -eq $start.server_instance_id -and $_.timestamp_unix_ms -ge $waveStart})
  $done=@($wave|Where-Object{$_.event -eq 'request_done'})
  $reports=@($wave|Where-Object{$_.event -eq 'throughput'})
  $b4=0;$b4Tokens=0;$decode=0;$running=0
  foreach($r in $reports){$b4+=$r.decode_batch.rounds_by_batch[3];$b4Tokens+=$r.decode_batch.committed_tokens_by_batch[3];$decode+=$r.tokens.committed_decode;$running=[Math]::Max($running,[int]$r.scheduler.running)}
  if($done.Count -eq 4 -and $decode -eq 252){break}
  Start-Sleep -Milliseconds 100
 }while($reportWait.ElapsedMilliseconds -lt 5000)
 if($done.Count -ne 4 -or $decode -ne 252 -or $running -ne 4 -or $b4 -le 0 -or $b4Tokens -le 0){throw 'Exact four-lane/63-decode-input/B4 evidence incomplete'}
 foreach($d in $done){if($d.result.prompt_tokens -ne 131009 -or $d.result.completion_tokens -ne 64 -or $d.result.prefix_cache_hit_tokens -ne 0){throw 'Cold independent matched-wave evidence incomplete'}}
 Save-Json 'c4-capacity-events.json' (@($start)+$wave)
}catch{
 $failure=$_.Exception.Message;[C4HostRequest]::AbortFour()
 # Failure cleanup touches only the caller-assigned process with unchanged
 # creation time and image. Host-owned lifecycle uses expected_session_id instead.
 try{
  $current=Get-Process -Id $EngineProcessId -ErrorAction Stop
  if($current.StartTime.ToUniversalTime() -ne $ownedStart -or $current.Path -ne $ExpectedEnginePath){throw 'Owned process changed; cleanup refused'}
  Stop-Process -Id $EngineProcessId -ErrorAction Stop
  $cleanup='Stopped exact caller-owned direct Engine PID'
 }catch{$cleanup=$_.Exception.Message}
}finally{
 Save-Json 'c4-capacity-result.json' @{scope='Direct loopback public-Engine capacity control; separate from Host lifecycle and model-quality qualification';engine_process_id=$EngineProcessId;engine_process_start_utc=$ownedStart.ToString('o');requested_draft_policy='auto';requested_draft_tokens=4;resolved_draft_policy=$e.speculative_width_policy;resolved_draft_window=$e.speculative_draft_window;responses=$responses;gpu_samples=$samples;elapsed_seconds=$timer.Elapsed.TotalSeconds;error=$failure;failure_cleanup=$cleanup;matched_outputs_per_lane=64;matched_decode_inputs_per_lane=63}
}
if($failure){throw $failure}
