# Run with Windows PowerShell 5.1 or PowerShell 7; no Hyper-V module is loaded.
# Loads production functions and its request dispatcher, then supplies an in-memory
# Windows filesystem, CIM inventory and Hyper-V cmdlets. This qualifies adapter
# behavior. COM, VHDX handling and a real Hyper-V installation need native VM QA.
param([string]$AdapterPath = (Join-Path $PSScriptRoot '../src/hyperv.ps1'))

$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText([IO.Path]::GetFullPath($AdapterPath))
# Windows runs use the production .NET path APIs. Non-Windows source runs
# replace only those primitives; their path normalization remains unqualified.
if ([IO.Path]::DirectorySeparatorChar -ne '\') {
    $source = $source.Replace('[IO.Path]::GetFullPath($path)', '(Get-FakeWindowsFullPath $path)')
    $source = $source.Replace('[IO.Path]::GetDirectoryName($current)', '(Get-FakeWindowsParent $current)')
    $source = $source.Replace('[IO.Path]::GetFileName($directory)', '(Get-FakeWindowsName $directory)')
    $source = $source.Replace('[IO.Path]::GetPathRoot($context.directory)', '(Get-FakeWindowsRoot $context.directory)')
    $source = $source.Replace('[IO.Path]::GetPathRoot($saved)', '(Get-FakeWindowsRoot $saved)')
    if ($source -match '\[IO\.Path\]::') { throw 'An unmocked Windows path API was added to the adapter.' }
}
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ($parseErrors | Out-String) }
foreach ($statement in $ast.EndBlock.Statements) {
    if ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) {
        . ([scriptblock]::Create($statement.Extent.Text))
    }
}
$script:ProductionCopyFile = ${function:CopyFile}
$dispatch = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
if ($dispatch.Count -ne 1) { throw 'Expected one production request dispatcher.' }
$body = $dispatch[0].Body.Extent.Text
$script:Dispatch = [scriptblock]::Create($body.Substring(1, $body.Length - 2))

function Assert-True($condition, [string]$message) {
    if (-not $condition) { throw $message }
    $script:Assertions++
}
function Assert-Equal($actual, $expected, [string]$message) {
    Assert-True (($actual | ConvertTo-Json -Depth 12 -Compress) -ceq ($expected | ConvertTo-Json -Depth 12 -Compress)) $message
}
function Assert-Failed([scriptblock]$operation, [string]$message, [string]$reason) {
    $failure = $null
    try { $null = & $operation } catch { $failure = $_.Exception.Message }
    Assert-True ($null -ne $failure) $message
    Assert-True ($failure.Contains($reason)) ("Unexpected refusal: " + $failure)
}
function Assert-Refused([scriptblock]$operation, [string]$message, [string]$reason) {
    Assert-Failed $operation $message $reason
    Assert-Equal @($script:Mutations.ToArray()) @() 'A refused ownership check mutated a resource.'
}
function Record-Mutation([string]$name, $arguments) {
    $script:Mutations.Add(@{ name=$name; arguments=$arguments })
}

function Get-FakeWindowsFullPath([string]$path) { $path.TrimEnd('\') }
function Get-FakeWindowsParent([string]$path) {
    $index = $path.TrimEnd('\').LastIndexOf('\')
    if ($index -lt 2) { return $null }
    $path.Substring(0, $index)
}
function Get-FakeWindowsName([string]$path) { ($path -split '\\')[-1] }
function Get-FakeWindowsRoot([string]$path) { $path.Substring(0, 2) + '\' }
function Join-Path {
    param([string]$Path, [string]$ChildPath)
    $Path.TrimEnd('\') + '\' + $ChildPath.TrimStart('\')
}
function CurrentUserSid { 'S-1-5-21-1000' }
function Test-Path {
    param([string]$LiteralPath, [string]$PathType)
    if ($LiteralPath.StartsWith('HKLM:', [StringComparison]::OrdinalIgnoreCase)) { return $script:RegistryKeys -contains $LiteralPath }
    if ($PathType -eq 'Leaf') { return $script:Files.ContainsKey($LiteralPath) }
    if ($PathType -eq 'Container') { return $script:Directories.ContainsKey($LiteralPath) }
    $script:Files.ContainsKey($LiteralPath) -or $script:Directories.ContainsKey($LiteralPath)
}
function Get-Item {
    param([string]$LiteralPath, [switch]$Force)
    $attributes = [IO.FileAttributes]::Normal
    if ($script:Redirects -contains $LiteralPath) { $attributes = [IO.FileAttributes]::ReparsePoint }
    [pscustomobject]@{ Attributes=$attributes; FullName=$LiteralPath }
}
function Get-Content {
    param([string]$LiteralPath, [switch]$Raw)
    if (-not $script:Files.ContainsKey($LiteralPath)) { throw 'Fake file missing.' }
    $script:Files[$LiteralPath]
}
function Get-ChildItem {
    param([string]$LiteralPath, [switch]$Recurse, [switch]$Force, [switch]$File)
    $prefix = $LiteralPath.TrimEnd('\') + '\'
    foreach ($path in @($script:Files.Keys) + @($script:Directories.Keys)) {
        if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $relative = $path.Substring($prefix.Length)
        if (-not $Recurse -and $relative.Contains('\')) { continue }
        $isDirectory = $script:Directories.ContainsKey($path)
        if ($File -and $isDirectory) { continue }
        [pscustomobject]@{ Name=(Get-FakeWindowsName $path); FullName=$path; PSIsContainer=$isDirectory; Length=([string]$script:Files[$path]).Length }
    }
}
function Remove-Item {
    param([string]$LiteralPath, [switch]$Force)
    Record-Mutation 'Remove-Item' @{ path=$LiteralPath }
    $script:Files.Remove($LiteralPath)
    $script:Vhds.Remove($LiteralPath)
}
function Move-Item {
    param([string]$LiteralPath, [string]$Destination)
    if (-not $script:Files.ContainsKey($LiteralPath)) { throw 'Fake move source missing.' }
    Record-Mutation 'Move-Item' @{ source=$LiteralPath; destination=$Destination }
    $script:Files[$Destination] = $script:Files[$LiteralPath]
    $script:Files.Remove($LiteralPath)
    if ($script:Vhds.ContainsKey($LiteralPath)) {
        $script:Vhds[$Destination] = $script:Vhds[$LiteralPath]
        $script:Vhds.Remove($LiteralPath)
    }
}
function CopyFile([string]$source, [string]$destination) {
    if (-not $script:Files.ContainsKey($source)) { throw 'Fake copy source missing.' }
    if ($script:Files.ContainsKey($destination)) { throw 'Fake copy refuses an existing destination.' }
    Record-Mutation 'CopyFile' @{ source=$source; destination=$destination }
    $script:Files[$destination] = $script:Files[$source]
    $script:Vhds[$destination] = $script:Vhds[$source].Clone()
    if ($script:FailCopy) { throw 'Fake copy interrupted.' }
}
function Get-VHD {
    [CmdletBinding()]
    param([string]$Path)
    $script:VhdReads.Add($Path)
    if (-not $script:Files.ContainsKey($Path) -or -not $script:Vhds.ContainsKey($Path)) { throw 'Fake VHDX missing.' }
    [pscustomobject]$script:Vhds[$Path]
}
function Resize-VHD {
    [CmdletBinding()]
    param([string]$Path, [uint64]$SizeBytes)
    if (-not $script:Vhds.ContainsKey($Path)) { throw 'Fake resize disk missing.' }
    Record-Mutation 'Resize-VHD' @{ path=$Path; size=$SizeBytes }
    if ($script:FailResize) { throw 'Fake disk expansion interrupted.' }
    if (-not $script:UnconfirmedResize) { $script:Vhds[$Path].Size = $SizeBytes }
}
function New-Object {
    [CmdletBinding()]
    param([Parameter(Position=0)][string]$TypeName, [string]$ComObject)
    if ($ComObject) {
        if ($ComObject -cne 'IMAPI2FS.MsftFileSystemImage') { throw 'Unexpected COM object.' }
        if (-not $script:Inventory.imapi) { throw 'IMAPI unavailable.' }
        return [pscustomobject]@{}
    }
    if ($TypeName -cne 'System.Collections.Generic.List[object]') { throw "Unexpected object type $TypeName" }
    return ,(Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName)
}
function Get-CimInstance {
    [CmdletBinding()]
    param([Parameter(Position=0)][string]$ClassName, [string]$Filter)
    switch ($ClassName) {
        'Win32_OperatingSystem' { [pscustomobject]@{ ProductType=1; OperatingSystemSKU=$script:Inventory.sku; FreePhysicalMemory=$script:Inventory.freeMemoryKiB } }
        'Win32_ComputerSystem' { [pscustomobject]@{ HypervisorPresent=$script:Inventory.hypervisor; NumberOfLogicalProcessors=$script:Inventory.cpus; TotalPhysicalMemory=16GB } }
        'Win32_Processor' { [pscustomobject]@{ VirtualizationFirmwareEnabled=$script:Inventory.firmware; SecondLevelAddressTranslationExtensions=$script:Inventory.slat } }
        'Win32_OptionalFeature' { [pscustomobject]@{ Name='Microsoft-Hyper-V-All'; InstallState=$script:Inventory.feature } }
        'Win32_LogicalDisk' { $script:Disks }
        default { throw "Unexpected CIM class $ClassName" }
    }
}
function Get-Service {
    [CmdletBinding()]
    param([string]$Name)
    if ($Name -ne 'vmms') { throw 'Unexpected service query.' }
    if ($script:Inventory.service) { [pscustomobject]@{ Status=$script:Inventory.service } }
}
function Get-Command {
    [CmdletBinding()]
    param([Parameter(Position=0)][string]$Name, [string]$CommandType)
    if ($Name -in @('Get-VM','Get-VHD','Resize-VHD')) {
        if ($script:Inventory.tools -and $Name -ne $script:MissingTool) { [pscustomobject]@{ Name=$Name } }
    } else { throw "Unexpected command lookup $Name" }
}
function Get-VM {
    [CmdletBinding()]
    param()
    if ($script:Inventory.denied) { throw 'Hyper-V access denied.' }
    $script:Vms
}
function Get-VMSwitch {
    [CmdletBinding()]
    param()
    $script:Switches
}
function Get-VMHardDiskDrive { param($VM) $VM.Disks | ForEach-Object { [pscustomobject]@{ Path=$_ } } }
function Get-VMDvdDrive { param($VM) $VM.Dvds | ForEach-Object { [pscustomobject]@{ Path=$_ } } }
function Get-VMNetworkAdapter { param($VM) $VM.Adapters }
function Get-VMComPort { param($VM) $VM.Ports }
function New-VM {
    param($Name, $Generation, $MemoryStartupBytes, $VHDPath, $Path, $SwitchName)
    Record-Mutation 'New-VM' $PSBoundParameters
    $vm = New-FakeVm
    $vm.Name = $Name
    $vm.Generation = $Generation
    $vm.ConfigurationLocation = $Path + '\Virtual Machines'
    $vm.Disks = @($VHDPath)
    $vm.Notes = ''
    $vm.Dvds = @()
    foreach ($port in $vm.Ports) { $port.Path = '' }
    $script:Vms = @($vm)
    $vm
}
function Set-VM {
    param($VM, $Notes, $AutomaticStartAction, $AutomaticStopAction, $CheckpointType)
    Record-Mutation 'Set-VM' @{ notes=$Notes; start=$AutomaticStartAction; stop=$AutomaticStopAction; checkpoint=$CheckpointType }
    $VM.Notes = $Notes
}
function Set-VMProcessor { param($VM, $Count) Record-Mutation 'Set-VMProcessor' @{ count=$Count } }
function Set-VMFirmware { param($VM, $EnableSecureBoot) Record-Mutation 'Set-VMFirmware' @{ secure_boot=$EnableSecureBoot } }
function Add-VMDvdDrive {
    param($VM, $Path)
    Record-Mutation 'Add-VMDvdDrive' @{ path=$Path }
    $VM.Dvds = @($Path)
}
function Set-VMComPort {
    param($VM, $Number, $Path)
    Record-Mutation 'Set-VMComPort' @{ number=$Number; path=$Path }
    $ports = @($VM.Ports | Where-Object { $_.Name -ceq ('COM ' + $Number) })
    if ($ports.Count -ne 1) { throw 'The requested fake COM port does not exist.' }
    $ports[0].Path = $Path
}
function Start-VM {
    param($VM, [switch]$Confirm)
    Record-Mutation 'Start-VM' @{ id=[string]$VM.Id }
    $VM.State = 'Running'
}
function Stop-VM {
    param($VM, [switch]$TurnOff, [switch]$Confirm)
    Record-Mutation 'Stop-VM' @{ id=[string]$VM.Id; force=[bool]$TurnOff }
    if ($TurnOff -or -not $script:DeferredShutdown) { $VM.State = 'Off' }
}
function Remove-VM {
    param($VM, [switch]$Confirm, [switch]$Force)
    Record-Mutation 'Remove-VM' @{ id=[string]$VM.Id }
    $script:Vms = @($script:Vms | Where-Object { $_.Id -ne $VM.Id })
}
function CreateIso([string]$seed, [string]$destination) {
    Record-Mutation 'CreateIso' @{ seed=$seed; destination=$destination }
    $script:Files[$destination] = 'fake ISO'
}
# These are forbidden even if someone runs the fake on a Windows installation
# that has the real management modules. The adapter must never invoke them.
function Enable-WindowsOptionalFeature { throw 'Host feature mutation is forbidden.' }
function Disable-WindowsOptionalFeature { throw 'Host feature mutation is forbidden.' }
function Install-WindowsFeature { throw 'Host feature installation is forbidden.' }
function New-VMSwitch { throw 'Host switch creation is forbidden.' }
function Set-VMSwitch { throw 'Host switch mutation is forbidden.' }
function Remove-VMSwitch { throw 'Host switch removal is forbidden.' }
function Set-VMNetworkAdapter { throw 'Host network mutation is forbidden.' }
function Restart-Computer { throw 'Host restart is forbidden.' }
function Start-Service { throw 'Host service mutation is forbidden.' }
function Set-Service { throw 'Host service mutation is forbidden.' }

function New-FakeVm {
    [pscustomobject]@{
        Id=[guid]'22222222-2222-4222-8222-222222222222'
        Name=('gbot-' + $script:Id)
        Notes=('GChat.Gbot.HyperV.v1|' + $script:Id + '|' + $script:Directory)
        ConfigurationLocation=($script:Directory + '\machine\Virtual Machines')
        Generation=2; State='Off'
        Disks=@($script:Directory + '\disk.vhdx')
        Dvds=@($script:Directory + '\seed.iso')
        Adapters=@([pscustomobject]@{ SwitchId=$script:SwitchId; IPAddresses=@('172.28.0.2', 'fe80::1', 'invalid') })
        # Get-VMComPort exposes Name/Id/Path, not the setter's Number argument.
        Ports=@(
            [pscustomobject]@{ Name='COM 1'; Id='Microsoft:22222222-2222-4222-8222-222222222222\8E3A359F-559A-4B6A-98A9-1690A6100ED7\0'; Path=('\\.\pipe\GChat-Gbot-' + $script:Id) },
            [pscustomobject]@{ Name='COM 2'; Id='Microsoft:22222222-2222-4222-8222-222222222222\8E3A359F-559A-4B6A-98A9-1690A6100ED7\1'; Path='' }
        )
    }
}
function Save-Claim($registeredId) {
    $script:Files[$script:Directory + '\setup.json'] = (@{
        directory=$script:Directory
        spec=@{ id=$script:Id; cpus=2; memory_mib=4096; disk_gib=40 }
        registered_id=$registeredId
    } | ConvertTo-Json -Depth 4)
}
function Reset-Fake([switch]$Owned) {
    $script:Id = '11111111-1111-4111-8111-111111111111'
    $script:Directory = 'F:\GChat\Gbot\S-1-5-21-1000\vms\' + $script:Id
    $script:SwitchId = [guid]'33333333-3333-4333-8333-333333333333'
    $script:Inventory = @{ sku=48; hypervisor=$true; firmware=$true; slat=$true; feature=1; service='Running'; tools=$true; imapi=$true; denied=$false; cpus=8; freeMemoryKiB=(8GB / 1KB) }
    $script:Disks = @(
        [pscustomobject]@{ DeviceID='C:'; FreeSpace=[uint64]200GB },
        [pscustomobject]@{ DeviceID='F:'; FreeSpace=[uint64]100GB }
    )
    $script:Switches = @([pscustomobject]@{ Name='Default Switch'; SwitchType='Internal'; Id=$script:SwitchId })
    $script:Files = @{ 'F:\accepted\guest.vhdx'='accepted image' }
    $script:Vhds = @{ 'F:\accepted\guest.vhdx'=@{ VhdFormat='VHDX'; VhdType='Dynamic'; ParentPath=''; Size=[uint64]3GB } }
    $script:VhdReads = New-Object 'System.Collections.Generic.List[object]'
    $script:Directories = @{}
    $script:Directories[$script:Directory] = $true
    $script:Redirects = @()
    $script:RegistryKeys = @()
    $script:Mutations = New-Object 'System.Collections.Generic.List[object]'
    $script:Vms = @()
    $script:DeferredShutdown = $false
    $script:MissingTool = $null
    $script:FailCopy = $false
    $script:FailResize = $false
    $script:UnconfirmedResize = $false
    Save-Claim $null
    if ($Owned) {
        $script:Vms = @(New-FakeVm)
        $script:Files[$script:Directory + '\disk.vhdx'] = 'retained disk'
        $script:Files[$script:Directory + '\seed.iso'] = 'retained ISO'
        Save-Claim ([string]$script:Vms[0].Id)
    }
}
# Use .NET constructors directly so the New-Object mock stays a narrow COM seam.
function Invoke-Operation([string]$action, $extra = @{}) {
    $request = @{ action=$action; id=$script:Id; directory=$script:Directory }
    foreach ($key in $extra.Keys) { $request[$key] = $extra[$key] }
    $reader = [IO.StringReader]::new(($request | ConvertTo-Json -Depth 12))
    $writer = [IO.StringWriter]::new()
    $oldInput = [Console]::In
    $oldOutput = [Console]::Out
    try {
        [Console]::SetIn($reader)
        [Console]::SetOut($writer)
        $null = & $script:Dispatch
        $writer.ToString() | ConvertFrom-Json
    } finally {
        [Console]::SetIn($oldInput)
        [Console]::SetOut($oldOutput)
        $reader.Dispose()
        $writer.Dispose()
    }
}

$script:Assertions = 0
$oldSystemDrive = $env:SystemDrive
try {
    # Exercise the production .NET copy seam with real files before mocking the
    # Hyper-V module: an immutable bundle must yield a writable guest disk.
    $copyRoot = [IO.Path]::Combine([IO.Path]::GetTempPath(), ('gchat-hyperv-copy-' + [Guid]::NewGuid()))
    [IO.Directory]::CreateDirectory($copyRoot) | Out-Null
    $copySource = [IO.Path]::Combine($copyRoot, 'accepted.vhdx')
    $copyDestination = [IO.Path]::Combine($copyRoot, 'owned.partial.vhdx')
    try {
        [IO.File]::WriteAllText($copySource, 'immutable accepted fixture')
        [IO.File]::SetAttributes($copySource, [IO.FileAttributes]::ReadOnly)
        & $script:ProductionCopyFile $copySource $copyDestination
        Assert-True (([IO.File]::GetAttributes($copySource) -band [IO.FileAttributes]::ReadOnly) -ne 0) 'Copying changed the accepted source read-only flag.'
        Assert-True (([IO.File]::GetAttributes($copyDestination) -band [IO.FileAttributes]::ReadOnly) -eq 0) 'The private guest disk inherited the immutable source read-only flag.'
        [IO.File]::AppendAllText($copyDestination, ' guest write')
        Assert-Equal ([IO.File]::ReadAllText($copySource)) 'immutable accepted fixture' 'Guest disk writes changed the accepted source.'
        Assert-Equal ([IO.File]::ReadAllText($copyDestination)) 'immutable accepted fixture guest write' 'The owned guest disk is not writable.'
    } finally {
        foreach ($path in @($copySource, $copyDestination)) {
            if ([IO.File]::Exists($path)) {
                [IO.File]::SetAttributes($path, [IO.FileAttributes]::Normal)
                [IO.File]::Delete($path)
            }
        }
        [IO.Directory]::Delete($copyRoot)
    }
    $env:SystemDrive = 'C:'
    Reset-Fake
    $detected = Invoke-Operation 'detect'
    Assert-Equal @($detected.issues) @() 'The supported detector fixture should be ready.'
    Assert-Equal $detected.preferred_root 'F:\GChat\Gbot\S-1-5-21-1000\vms' 'Detection must prefer a non-system disk even when the system disk has more space.'
    Assert-Equal $detected.cpus 8 'Detection lost processor inventory.'
    Assert-Equal $detected.memory_mib 16384 'Detection lost memory inventory.'
    Assert-Equal @($script:Mutations.ToArray()) @() 'Detection must remain read-only.'

    foreach ($case in @('cpu_unavailable','memory_unavailable','windows_edition','virtualization_disabled','hyperv_disabled','hyperv_service','hyperv_tools','hyperv_access','seed_iso_unavailable','disk_space')) {
        Reset-Fake
        switch ($case) {
            'cpu_unavailable' { $script:Inventory.cpus = 1 }
            'memory_unavailable' { $script:Inventory.freeMemoryKiB = 4GB / 1KB - 1 }
            'windows_edition' { $script:Inventory.sku = 101 }
            'virtualization_disabled' { $script:Inventory.hypervisor=$false; $script:Inventory.firmware=$false }
            'hyperv_disabled' { $script:Inventory.feature = 2 }
            'hyperv_service' { $script:Inventory.service = 'Stopped' }
            'hyperv_tools' { $script:Inventory.tools = $false }
            'hyperv_access' { $script:Inventory.denied = $true }
            'seed_iso_unavailable' { $script:Inventory.imapi = $false }
            'disk_space' { $script:Disks | ForEach-Object { $_.FreeSpace = [uint64]1GB } }
        }
        $result = Invoke-Operation 'detect'
        $issue = @($result.issues | Where-Object { $_.code -eq $case })
        Assert-True ($issue.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace($issue[0].next_action)) "Missing actionable detector issue $case."
        Assert-Equal @($script:Mutations.ToArray()) @() "Detection mutated the host for $case."
    }
    foreach ($tool in @('Get-VHD','Resize-VHD')) {
        Reset-Fake
        $script:MissingTool = $tool
        Assert-True (@((Invoke-Operation 'detect').issues | Where-Object { $_.code -eq 'hyperv_tools' }).Count -eq 1) "Detection must require the built-in $tool cmdlet."
        Assert-Equal @($script:Mutations.ToArray()) @() 'VHD cmdlet detection changed the host.'
    }
    foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')) {
        Reset-Fake
        $script:RegistryKeys = @($key)
        $restart = @((Invoke-Operation 'detect').issues | Where-Object { $_.code -eq 'windows_restart_required' })
        Assert-True ($restart.Count -eq 1 -and $restart[0].next_action.Contains('restart Windows yourself')) 'A pending Windows restart needs a plain user action.'
        Assert-Equal @($script:Mutations.ToArray()) @() 'Pending-restart detection mutated the host.'
    }
    foreach ($case in @('absent','external','duplicate')) {
        Reset-Fake
        switch ($case) {
            'absent' { $script:Switches = @() }
            'external' { $script:Switches[0].SwitchType = 'External' }
            'duplicate' { $script:Switches += $script:Switches[0] }
        }
        Assert-True (@((Invoke-Operation 'detect').issues | Where-Object { $_.code -eq 'hyperv_access' }).Count -eq 1) "Detection must refuse an $case Default Switch."
        Assert-Equal @($script:Mutations.ToArray()) @() 'Detection tried to create or repair a switch.'
    }
    Reset-Fake
    $script:Inventory.firmware = $false
    Assert-Equal @((Invoke-Operation 'detect').issues) @() 'An already active hypervisor must not depend on the unavailable firmware flag.'
    Reset-Fake
    $script:Disks | ForEach-Object { $_.FreeSpace = [uint64]40GB }
    Assert-True (@((Invoke-Operation 'detect').issues | Where-Object { $_.code -eq 'disk_space' }).Count -eq 1) 'A new guest must reserve setup space beyond its 40 GiB disk.'
    $script:Disks[1].FreeSpace = [uint64]41GB
    Assert-Equal @((Invoke-Operation 'detect').issues) @() 'Exactly 41 GiB must satisfy a new guest reservation.'
    Reset-Fake
    $savedRoot = Get-FakeWindowsParent $script:Directory
    $script:Disks | ForEach-Object { $_.FreeSpace = [uint64]1GB }
    $saved = Invoke-Operation 'detect' @{ saved_root=$savedRoot }
    Assert-Equal $saved.preferred_root $savedRoot 'A saved setup must retain its original low-space drive.'
    Assert-Equal @($saved.issues) @() 'Restart preflight must not reserve a fresh guest disk.'
    Assert-Equal @($script:Mutations.ToArray()) @() 'Saved-root detection must remain read-only.'
    $missing = Invoke-Operation 'detect' @{ saved_root='Z:\GChat\Gbot\S-1-5-21-1000\vms' }
    Assert-True (@($missing.issues | Where-Object { $_.code -eq 'saved_disk_unavailable' }).Count -eq 1) 'An unavailable saved drive needs an actionable issue.'
    Assert-True ($null -eq $missing.preferred_root) 'A missing saved drive must not silently select another drive.'

    foreach ($case in @('missing','unreadable','format','fixed','parent','zero','too_small','oversized')) {
        Reset-Fake
        $sourceDisk = $script:Vhds['F:\accepted\guest.vhdx']
        $reason = 'standalone dynamic VHDX'
        switch ($case) {
            'missing' { $script:Files.Remove('F:\accepted\guest.vhdx'); $reason='accepted guest image is missing' }
            'unreadable' { $script:Vhds.Remove('F:\accepted\guest.vhdx'); $reason='Fake VHDX missing' }
            'format' { $sourceDisk.VhdFormat = 'VHD' }
            'fixed' { $sourceDisk.VhdType = 'Fixed' }
            'parent' { $sourceDisk.ParentPath = 'F:\foreign\parent.vhdx' }
            'zero' { $sourceDisk.Size = [uint64]0 }
            'too_small' { $sourceDisk.Size = [uint64]512MB }
            'oversized' { $sourceDisk.Size = [uint64]41GB }
        }
        $script:Files[$script:Directory + '\disk.partial.vhdx'] = 'retained partial'
        Assert-Refused { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } "Preparation accepted an invalid $case VHDX." $reason
        Assert-Equal $script:Files[$script:Directory + '\disk.partial.vhdx'] 'retained partial' 'Asset refusal removed a previous partial output.'
    }
    foreach ($path in @('F:\accepted\guest.vhdx', ($script:Directory + '\disk.partial.vhdx'))) {
        Reset-Fake
        $script:Files[$script:Directory + '\disk.partial.vhdx'] = 'retained partial'
        $script:Redirects = @($path)
        Assert-Refused { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } 'Preparation accepted a redirected source or partial disk.' 'must not contain links'
        Assert-Equal $script:Files[$script:Directory + '\disk.partial.vhdx'] 'retained partial' 'Redirect refusal changed a partial output.'
    }
    foreach ($failure in @('copy','resize','unconfirmed_resize')) {
        Reset-Fake
        switch ($failure) {
            'copy' { $script:FailCopy = $true; $reason='could not be copied' }
            'resize' { $script:FailResize = $true; $reason='could not be expanded' }
            'unconfirmed_resize' { $script:UnconfirmedResize = $true; $reason='capacity was not confirmed' }
        }
        Assert-Failed { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } "A $failure failure unexpectedly registered a guest." $reason
        Assert-True ($script:Files.ContainsKey($script:Directory + '\setup.json')) 'An interrupted copy or expansion removed its claim.'
        Assert-True ($script:Files.ContainsKey($script:Directory + '\disk.partial.vhdx')) 'An interrupted copy or expansion removed its partial output.'
        Assert-True (-not $script:Files.ContainsKey($script:Directory + '\disk.vhdx')) 'An unconfirmed partial disk became the final guest disk.'
        Assert-Equal $script:Vms.Count 0 'An interrupted disk preparation registered a VM.'
        Assert-Equal $script:Vhds['F:\accepted\guest.vhdx'].Size ([uint64]3GB) 'An interrupted preparation resized the pinned source.'
        $script:FailCopy = $false
        $script:FailResize = $false
        $script:UnconfirmedResize = $false
        $script:Mutations.Clear()
        Assert-True ((Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 }).registered) 'An explicit retry failed to rebuild its owned partial disk.'
        Assert-True (@($script:Mutations | Where-Object { $_.name -eq 'Remove-Item' -and $_.arguments.path -ceq ($script:Directory + '\disk.partial.vhdx') }).Count -eq 1) 'Retry did not replace only its exact owned partial disk.'
        Assert-True (-not $script:Files.ContainsKey($script:Directory + '\disk.partial.vhdx')) 'Successful retry left a duplicate partial disk.'
    }
    Reset-Fake
    $script:Vhds['F:\accepted\guest.vhdx'].Size = [uint64]40GB
    Assert-True ((Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 }).registered) 'An already-sized VHDX could not be prepared.'
    Assert-True (@($script:Mutations | Where-Object { $_.name -eq 'Resize-VHD' }).Count -eq 0) 'An already-sized VHDX must not be resized.'

    Reset-Fake
    $prepared = Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 }
    Assert-True $prepared.registered 'Preparation did not register the owned VM.'
    Assert-Equal $prepared.vm_id ([string]$script:Vms[0].Id) 'Preparation did not return the actual Hyper-V GUID.'
    $created = @($script:Mutations | Where-Object { $_.name -eq 'New-VM' })[0].arguments
    Assert-True ($created.Generation -eq 2 -and $created.MemoryStartupBytes -eq 4GB -and $created.SwitchName -ceq 'Default Switch') 'Preparation did not use the fixed guest or existing Default Switch.'
    $policy = @($script:Mutations | Where-Object { $_.name -eq 'Set-VM' })[0].arguments
    Assert-True ($policy.start -ceq 'Nothing' -and $policy.stop -ceq 'ShutDown' -and $policy.checkpoint -ceq 'Disabled') 'Preparation changed the owned VM automatic lifecycle policy.'
    Assert-True (@($script:Mutations | Where-Object { $_.name -eq 'Set-VMProcessor' -and $_.arguments.count -eq 2 }).Count -eq 1) 'The owned guest must use two CPU threads.'
    Assert-True (@($script:Mutations | Where-Object { $_.name -eq 'Set-VMFirmware' -and $_.arguments.secure_boot -ceq 'Off' }).Count -eq 1) 'Only the guest Secure Boot setting should change.'
    Assert-True (@($script:Mutations | Where-Object { $_.name -eq 'Set-VMComPort' -and $_.arguments.number -eq 1 -and $_.arguments.path -ceq ('\\.\pipe\GChat-Gbot-' + $script:Id) }).Count -eq 1) 'The owned guest must use its exact COM1 pipe.'
    Assert-True (@($script:Mutations | Where-Object { $_.name -eq 'CopyFile' -and $_.arguments.source -ceq 'F:\accepted\guest.vhdx' -and $_.arguments.destination -ceq ($script:Directory + '\disk.partial.vhdx') }).Count -eq 1) 'Preparation must copy only the accepted VHDX into its owned partial path.'
    Assert-True (@($script:Mutations | Where-Object { $_.name -eq 'Resize-VHD' -and $_.arguments.path -ceq ($script:Directory + '\disk.partial.vhdx') -and $_.arguments.size -eq 40GB }).Count -eq 1) 'The copied 3 GiB guest disk must expand to 40 GiB.'
    Assert-Equal $script:Vhds[$script:Directory + '\disk.vhdx'].Size ([uint64]40GB) 'The registered disk capacity was not confirmed.'
    Assert-Equal $script:Vhds['F:\accepted\guest.vhdx'].Size ([uint64]3GB) 'Preparation resized the accepted source asset.'
    Assert-Equal $script:Files['F:\accepted\guest.vhdx'] 'accepted image' 'Preparation changed the accepted source asset.'
    Assert-Equal @($script:VhdReads.ToArray()) @('F:\accepted\guest.vhdx', ($script:Directory + '\disk.partial.vhdx'), ($script:Directory + '\disk.partial.vhdx')) 'Preparation must validate the source, copied disk and confirmed expanded disk.'
    Save-Claim $prepared.vm_id
    $script:Mutations.Clear()
    Assert-Equal (Invoke-Operation 'start' @{ vm_id=$prepared.vm_id }).state 'Running' 'Start did not use the persisted owned VM.'
    Assert-Equal @((Invoke-Operation 'endpoint').addresses) @('172.28.0.2') 'Endpoint must return only valid IPv4 guest addresses.'
    $script:DeferredShutdown = $true
    Assert-Equal (Invoke-Operation 'stop').state 'Running' 'An unconfirmed graceful shutdown must not report Off.'
    $lastStop = @($script:Mutations | Where-Object { $_.name -eq 'Stop-VM' })[-1]
    Assert-True (-not $lastStop.arguments.force) 'Stop must never force power off.'
    $script:DeferredShutdown = $false
    Assert-Equal (Invoke-Operation 'stop').state 'Off' 'A graceful retry did not observe Off.'
    Assert-True ($script:Files.ContainsKey($script:Directory + '\disk.vhdx')) 'Stop deleted the saved guest disk.'
    Assert-Equal (Invoke-Operation 'start').state 'Running' 'The saved guest could not restart.'
    Assert-Equal (Invoke-Operation 'force_stop').state 'Off' 'Explicit force_stop did not stop the owned guest.'
    $lastStop = @($script:Mutations | Where-Object { $_.name -eq 'Stop-VM' })[-1]
    Assert-True ($lastStop.arguments.force) 'Explicit force_stop did not use TurnOff.'
    Assert-True ((Invoke-Operation 'unregister').removed) 'Unregister did not confirm removal.'
    Assert-True (-not (Invoke-Operation 'inspect').registered) 'The removed VM still appeared registered.'
    Assert-True ($script:Files.ContainsKey($script:Directory + '\disk.vhdx')) 'Unregister must not delete disk files itself.'

    foreach ($case in @('name','id','tag','configuration','generation','disk','dvd','switch','serial','extra_serial','misplaced_serial','duplicate')) {
        Reset-Fake -Owned
        $vm = $script:Vms[0]
        $reason = 'exact GChat ownership tag'
        switch ($case) {
            'name' { $vm.Name = $vm.Name.ToUpperInvariant() }
            'id' { $vm.Id = [guid]::NewGuid(); $reason='different Hyper-V guest' }
            'tag' { $vm.Notes = 'foreign guest' }
            'configuration' { $vm.ConfigurationLocation = $script:Directory + '-other\machine' }
            'generation' { $vm.Generation = 1 }
            'disk' { $vm.Disks = @('F:\foreign\disk.vhdx'); $reason='foreign or unexpected disk' }
            'dvd' { $vm.Dvds = @('F:\foreign\seed.iso'); $reason='foreign or unexpected setup disc' }
            'switch' { $vm.Adapters[0].SwitchId = [guid]::NewGuid(); $reason='existing Default Switch' }
            'serial' { $vm.Ports[0].Path = '\\.\pipe\foreign'; $reason='foreign serial pipe' }
            'extra_serial' { $vm.Ports[1].Path = '\\.\pipe\foreign'; $reason='foreign serial pipe' }
            'misplaced_serial' { $vm.Ports[1].Path = $vm.Ports[0].Path; $vm.Ports[0].Path = ''; $reason='foreign serial pipe' }
            'duplicate' { $script:Vms += New-FakeVm; $reason='different Hyper-V guest' }
        }
        Assert-Refused { Invoke-Operation 'stop' } "Foreign $case resources were accepted." $reason
    }
    Reset-Fake -Owned
    $script:Files[$script:Directory + '\setup.json'] = (@{ directory=$script:Directory; spec=@{ id=[guid]::NewGuid() }; registered_id=$script:Vms[0].Id } | ConvertTo-Json)
    Assert-Refused { Invoke-Operation 'start' } 'A foreign persisted claim was accepted.' 'persisted guest claim'
    Reset-Fake -Owned
    Assert-Refused { Invoke-Operation 'start' @{ vm_id=[guid]::NewGuid() } } 'A request with the wrong Hyper-V GUID was accepted.' 'requested Hyper-V identity'
    Reset-Fake -Owned
    $script:Redirects = @($script:Directory + '\setup.json')
    Assert-Refused { Invoke-Operation 'unregister' } 'A redirected setup claim was accepted.' 'must not contain links'
    Reset-Fake -Owned
    $script:Vms[0].State = 'Running'
    Assert-Refused { Invoke-Operation 'unregister' } 'A running owned VM was unregistered.' 'Stop the owned bot computer'
    Reset-Fake -Owned
    $script:Vms[0].State = 'Saved'
    Assert-Refused { Invoke-Operation 'start' } 'An uncertain saved state was started automatically.' 'not stopped'

    foreach ($field in @('cpus','memory_mib','disk_gib')) {
        Reset-Fake
        $resources = @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 }
        $resources[$field]++
        Assert-Refused { Invoke-Operation 'prepare' $resources } "Preparation changed persisted $field." 'requested guest resources'
    }
    Reset-Fake
    $script:Disks[1].FreeSpace = [uint64]40GB
    Assert-Refused { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } 'Preparation allocated on a drive without setup space.' 'selected local drive'
    Reset-Fake -Owned
    $ownedId = [string]$script:Vms[0].Id
    $script:Disks[1].FreeSpace = [uint64]1GB
    $reused = Invoke-Operation 'prepare' @{ cpus=2; memory_mib=4096; disk_gib=40 }
    Assert-Equal $reused.vm_id $ownedId 'Low free space must not recreate an existing registered guest.'
    Assert-True (@($script:Mutations | Where-Object { $_.name -in @('New-VM','CopyFile','Resize-VHD','CreateIso','Remove-Item','Move-Item') }).Count -eq 0) 'Registered guest reuse rebuilt its saved disk.'
    Reset-Fake -Owned
    $script:Vms = @()
    Assert-Refused { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } 'A missing registered VM was recreated automatically.' 'previously registered owned guest is missing'
    Reset-Fake
    $foreign = New-FakeVm
    $foreign.Name = 'unrelated'
    $script:Vms = @($foreign)
    Assert-Refused { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } 'A disk attached to another VM was overwritten.' 'attached to another VM'
    Reset-Fake
    $foreign = New-FakeVm
    $foreign.Name = 'unrelated'
    $foreign.Disks = @($script:Directory + '\disk.partial.vhdx')
    $script:Vms = @($foreign)
    $script:Files[$script:Directory + '\disk.partial.vhdx'] = 'foreign attached disk'
    Assert-Refused { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } 'A partial disk attached to another VM was overwritten.' 'attached to another VM'
    Assert-Equal $script:Files[$script:Directory + '\disk.partial.vhdx'] 'foreign attached disk' 'A foreign attached partial disk was changed.'
    Reset-Fake
    $script:Files.Remove($script:Directory + '\setup.json')
    Assert-Refused { Invoke-Operation 'prepare' @{ image='F:\accepted\guest.vhdx'; cpus=2; memory_mib=4096; disk_gib=40 } } 'Preparation without an owned claim was accepted.' 'no persisted owned setup claim'

    Reset-Fake
    $script:Files.Remove($script:Directory + '\setup.json')
    $script:Directories.Clear()
    Assert-True (-not (Invoke-Operation 'inspect').registered) 'An absent preclaim directory could not be inspected.'
    $script:Directories[$script:Directory] = $true
    foreach ($name in @('owner.lock','setup.lock','setup.json.write.tmp')) { $script:Files[$script:Directory + '\' + $name] = '' }
    Assert-True (-not (Invoke-Operation 'inspect').registered) 'Known preclaim locks and temporary files were treated as foreign.'
    $script:Files[$script:Directory + '\foreign.txt'] = 'user data'
    Assert-Refused { Invoke-Operation 'inspect' } 'A no-claim directory containing user data was accepted.' 'foreign files'
    Reset-Fake
    $script:Files.Remove($script:Directory + '\setup.json')
    $script:Vms = @(New-FakeVm)
    Assert-Refused { Invoke-Operation 'inspect' } 'A registered name collision without a saved claim was adopted.' 'without this setup'

    [Console]::Out.WriteLine("Hyper-V module fake: $script:Assertions assertions passed; no host virtualization commands executed.")
} finally {
    $env:SystemDrive = $oldSystemDrive
}
