# Production adapter: JSON stdin/stdout, compatible with Windows PowerShell 5.1.
# No feature activation, installation, elevation, switch or host-network changes.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Issue($code, $message, $next) {
    @{ code = $code; message = $message; next_action = $next }
}
function FullPath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path) -or $path -notmatch '^[A-Za-z]:\\') {
        throw 'Guest storage must use an absolute local Windows drive path.'
    }
    [IO.Path]::GetFullPath($path).TrimEnd('\')
}
function SamePath([string]$left, [string]$right) {
    [string]::Equals((FullPath $left), (FullPath $right), [StringComparison]::OrdinalIgnoreCase)
}
function Below([string]$child, [string]$parent) {
    (FullPath $child).StartsWith((FullPath $parent) + '\', [StringComparison]::OrdinalIgnoreCase)
}
function NoRedirects([string]$path) {
    $current = FullPath $path
    while (-not [string]::IsNullOrEmpty($current)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Guest storage must not contain links, junctions or redirected paths.'
            }
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}
function DefaultSwitch {
    $switches = @(Get-VMSwitch -ErrorAction Stop | Where-Object { $_.Name -ceq 'Default Switch' })
    if ($switches.Count -ne 1 -or [string]$switches[0].SwitchType -ne 'Internal') {
        throw 'The existing Hyper-V Default Switch is unavailable. Open Hyper-V Manager and check its Default Switch, then retry. GChat does not create or change switches.'
    }
    $switches[0]
}
function CurrentUserSid {
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
}
function Detect($request) {
    $issues = New-Object 'System.Collections.Generic.List[object]'
    $os = Get-CimInstance Win32_OperatingSystem
    $computer = Get-CimInstance Win32_ComputerSystem
    $processors = @(Get-CimInstance Win32_Processor)
    if ([int]$computer.NumberOfLogicalProcessors -lt 2) {
        $issues.Add((Issue 'cpu_unavailable' 'This computer has fewer than two available CPU threads.' 'Provide two available CPU threads before creating the bot computer.'))
    }
    if ([uint64]$os.FreePhysicalMemory -lt 4GB / 1KB) {
        $issues.Add((Issue 'memory_unavailable' 'Less than 4 GiB of host memory is available for the bot computer.' 'Free at least 4 GiB of memory, then retry.'))
    }
    if ((Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or
        (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')) {
        $issues.Add((Issue 'windows_restart_required' 'Windows has a pending restart.' 'Save your work and restart Windows yourself, then check again before creating or starting the bot computer. GChat does not restart this computer.'))
    }
    # Home/Core editions cannot host the product's Hyper-V guest.
    if ([int]$os.ProductType -eq 1 -and [int]$os.OperatingSystemSKU -notin @(4,27,48,49,70,72,121,122,125,126,161,162,164,165,188,191)) {
        $issues.Add((Issue 'windows_edition' 'This Windows edition cannot run a local Hyper-V bot computer.' 'Use Windows Pro, Enterprise or Education, or connect a dedicated LAN bot computer instead.'))
    }
    if (-not $computer.HypervisorPresent -and @($processors | Where-Object { -not $_.VirtualizationFirmwareEnabled -or -not $_.SecondLevelAddressTranslationExtensions }).Count -gt 0) {
        $issues.Add((Issue 'virtualization_disabled' 'Hardware virtualization is unavailable or disabled in firmware.' 'Enable Intel VT-x or AMD-V in this computer''s firmware yourself, restart Windows, then check again.'))
    }
    $features = @(Get-CimInstance Win32_OptionalFeature | Where-Object { $_.Name -eq 'Microsoft-Hyper-V-All' -or $_.Name -eq 'Microsoft-Hyper-V' })
    if (@($features | Where-Object { $_.InstallState -eq 1 }).Count -eq 0) {
        $issues.Add((Issue 'hyperv_disabled' 'Hyper-V is not enabled on this computer.' 'Open Turn Windows features on or off, enable Hyper-V yourself with administrator approval, restart Windows, then check again. GChat does not change Windows features.'))
    }
    $service = Get-Service -Name vmms -ErrorAction SilentlyContinue
    if ($null -eq $service -or [string]$service.Status -ne 'Running') {
        $issues.Add((Issue 'hyperv_service' 'The Hyper-V management service is not running.' 'After enabling Hyper-V, restart Windows. If it is already enabled, ask your administrator to check the Hyper-V Virtual Machine Management service, then retry.'))
    }
    if (@('Get-VM','Get-VHD','Resize-VHD' | Where-Object { $null -eq (Get-Command $_ -ErrorAction SilentlyContinue) }).Count -gt 0) {
        $issues.Add((Issue 'hyperv_tools' 'The Windows Hyper-V management tools are unavailable.' 'Enable the Hyper-V Management Tools in Windows features yourself, restart if Windows asks, then retry.'))
    } elseif ($null -ne $service -and [string]$service.Status -eq 'Running') {
        try {
            $null = @(Get-VM -ErrorAction Stop)
            $null = DefaultSwitch
        } catch {
            $issues.Add((Issue 'hyperv_access' 'GChat cannot manage a local Hyper-V bot computer with this Windows account.' 'Ask your administrator to grant this account Hyper-V Administrators access and check the existing Default Switch. Sign out and back in, then retry.'))
        }
    }
    try {
        $null = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
    } catch {
        $issues.Add((Issue 'seed_iso_unavailable' 'Windows cannot create the guest''s setup disc with its built-in IMAPI service.' 'Ask your administrator to restore Windows IMAPI components, then retry. No third-party disc tool is installed.'))
    }
    $system = ([string]$env:SystemDrive).TrimEnd('\')
    $disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
        @{ root = [string]$_.DeviceID + '\'; free_bytes = [uint64]$_.FreeSpace; system = ([string]$_.DeviceID -ieq $system) }
    } | Sort-Object @{Expression={$_.system}}, @{Expression={$_.free_bytes}; Descending=$true})
    $usable = @($disks | Where-Object { $_.free_bytes -ge 41GB })
    $preferred = $null
    if (-not [string]::IsNullOrEmpty([string]$request.saved_root)) {
        $saved = FullPath ([string]$request.saved_root)
        NoRedirects $saved
        $volume = @($disks | Where-Object { $_.root.TrimEnd('\') -ieq [IO.Path]::GetPathRoot($saved).TrimEnd('\') })
        if ($volume.Count -ne 1) {
            $issues.Add((Issue 'saved_disk_unavailable' 'The drive holding this bot computer is unavailable.' 'Reconnect its original local drive, then retry this saved setup. GChat will not move or recreate it on another drive.'))
        } else {
            # Preparation checks allocation for new/partial disks. Restarting an
            # existing disk does not reserve its full capacity a second time.
            $preferred = $saved
        }
    } elseif ($usable.Count -gt 0) {
        $sid = CurrentUserSid
        $preferred = Join-Path $usable[0].root ('GChat\Gbot\' + $sid + '\vms')
    } else {
        $issues.Add((Issue 'disk_space' 'No local drive has 41 GiB free for a separate bot computer and its setup files.' 'Free space on a local drive, preferably a non-system drive, then check again.'))
    }
    @{ issues = @($issues.ToArray()); storage_candidates = @($disks); preferred_root = $preferred; cpus = [Math]::Min(65535, [int]$computer.NumberOfLogicalProcessors); memory_mib = [uint32]([uint64]$computer.TotalPhysicalMemory / 1MB) }
}
function Context($request) {
    $id = [Guid]::Parse([string]$request.id)
    if ($id -eq [Guid]::Empty) { throw 'The owned guest identity is missing.' }
    $directory = FullPath ([string]$request.directory)
    if ([IO.Path]::GetFileName($directory) -cne $id.ToString()) {
        throw 'The guest directory does not match its owned identity.'
    }
    NoRedirects $directory
    foreach ($file in @('setup.json','disk.vhdx','seed.iso','disk.partial.vhdx','seed.partial.iso','serial.log')) {
        NoRedirects (Join-Path $directory $file)
    }
    $claim = $null
    $claimPath = Join-Path $directory 'setup.json'
    if (Test-Path -LiteralPath $claimPath -PathType Leaf) {
        $claim = Get-Content -LiteralPath $claimPath -Raw | ConvertFrom-Json
        if ([Guid]$claim.spec.id -ne $id -or -not (SamePath ([string]$claim.directory) $directory)) {
            throw 'The persisted guest claim belongs to a different identity or directory.'
        }
    } elseif ($request.action -eq 'inspect') {
        # Removal can inspect a setup before its first durable claim. Only an
        # absent directory or known preclaim lock/temp files are safe to remove.
        if (Test-Path -LiteralPath $directory) {
            if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
                throw 'The guest storage path is not an owned directory.'
            }
            foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force)) {
                if ($entry.PSIsContainer -or ($entry.Name -cne 'owner.lock' -and $entry.Name -cne 'setup.lock' -and $entry.Name -cnotmatch '^setup\.json\..+\.tmp$')) {
                    throw 'The guest directory has foreign files and no persisted owned setup claim. Its resources were left unchanged.'
                }
                NoRedirects $entry.FullName
            }
        }
    } else {
        throw 'The guest has no persisted owned setup claim.'
    }
    $registeredId = $null
    if ($null -ne $claim -and $null -ne $claim.registered_id) { $registeredId = [Guid]::Parse([string]$claim.registered_id) }
    if ($null -ne $request.vm_id -and ($null -eq $registeredId -or [Guid]$request.vm_id -ne $registeredId)) {
        throw 'The requested Hyper-V identity differs from its persisted claim.'
    }
    @{ claim=$claim; id=$id; directory=$directory; name=('gbot-' + $id); tag=('GChat.Gbot.HyperV.v1|' + $id + '|' + $directory); vm_id=$registeredId; disk=(Join-Path $directory 'disk.vhdx'); iso=(Join-Path $directory 'seed.iso'); pipe=('\\.\pipe\GChat-Gbot-' + $id) }
}
function OwnedVm($context, [bool]$incomplete = $false) {
    $all = @(Get-VM -ErrorAction Stop)
    $named = @($all | Where-Object { $_.Name -ieq $context.name })
    $identified = @($all | Where-Object { $null -ne $context.vm_id -and [Guid]$_.Id -eq $context.vm_id })
    if ($named.Count -eq 0 -and $identified.Count -eq 0) { return $null }
    if ($null -eq $context.claim) {
        throw 'A Hyper-V guest exists without this setup''s persisted ownership claim. Its resources were left unchanged.'
    }
    if ($named.Count -ne 1 -or ($null -ne $context.vm_id -and [Guid]$named[0].Id -ne $context.vm_id)) {
        throw 'A different Hyper-V guest uses this name or identity. Its resources were left unchanged.'
    }
    $vm = $named[0]
    if ($vm.Name -cne $context.name -or $vm.Notes -cne $context.tag -or -not (Below ([string]$vm.ConfigurationLocation) $context.directory) -or [int]$vm.Generation -ne 2) {
        throw 'The Hyper-V guest is missing the exact GChat ownership tag or owned configuration path. Its resources were left unchanged.'
    }
    $drives = @(Get-VMHardDiskDrive -VM $vm)
    if ($drives.Count -ne 1 -or -not (SamePath ([string]$drives[0].Path) $context.disk)) {
        throw 'The Hyper-V guest has a foreign or unexpected disk. Its resources were left unchanged.'
    }
    $dvds = @(Get-VMDvdDrive -VM $vm)
    if ($dvds.Count -gt 1 -or ($dvds.Count -eq 1 -and -not (SamePath ([string]$dvds[0].Path) $context.iso)) -or (-not $incomplete -and $dvds.Count -ne 1)) {
        throw 'The Hyper-V guest has a foreign or unexpected setup disc. Its resources were left unchanged.'
    }
    $switch = DefaultSwitch
    $adapters = @(Get-VMNetworkAdapter -VM $vm)
    if ($adapters.Count -ne 1 -or [Guid]$adapters[0].SwitchId -ne [Guid]$switch.Id) {
        throw 'The Hyper-V guest is not attached only to the existing Default Switch.'
    }
    $ports = @(Get-VMComPort -VM $vm)
    foreach ($port in $ports) {
        if (-not [string]::IsNullOrEmpty([string]$port.Path) -and ([int]$port.Number -ne 1 -or [string]$port.Path -cne $context.pipe)) {
            throw 'The Hyper-V guest has a foreign serial pipe. Its resources were left unchanged.'
        }
    }
    if (-not $incomplete -and @($ports | Where-Object { $_.Number -eq 1 -and $_.Path -ceq $context.pipe }).Count -ne 1) {
        throw 'The owned Hyper-V serial channel is missing.'
    }
    $vm
}
function CreateIso([string]$seed, [string]$destination) {
    NoRedirects $seed
    foreach ($item in @(Get-ChildItem -LiteralPath $seed -Recurse -Force)) { NoRedirects $item.FullName }
    $image = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
    $image.FileSystemsToCreate = 3 # ISO9660 and Joliet; Linux mounts label cidata.
    $image.VolumeName = 'cidata'
    $image.Root.AddTree($seed, $false)
    $result = $image.CreateResultImage()
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class GChatIsoStream {
    public static void Save(object value, string path) {
        IStream stream = (IStream)value;
        byte[] buffer = new byte[1024 * 1024];
        IntPtr count = Marshal.AllocHGlobal(4);
        try {
            using (FileStream output = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) {
                for (;;) {
                    stream.Read(buffer, buffer.Length, count);
                    int read = Marshal.ReadInt32(count);
                    if (read == 0) break;
                    output.Write(buffer, 0, read);
                }
                output.Flush(true);
            }
        } finally { Marshal.FreeHGlobal(count); }
    }
}
'@
    [GChatIsoStream]::Save($result.ImageStream, $destination)
}
function CopyFile([string]$source, [string]$destination) {
    # Never overwrite an unexpected output between the ownership check and copy.
    [IO.File]::Copy($source, $destination, $false)
}
function GuestDisk([string]$path, [uint64]$capacity) {
    $disk = Get-VHD -Path $path -ErrorAction Stop
    if ([string]$disk.VhdFormat -ne 'VHDX' -or [string]$disk.VhdType -ne 'Dynamic' -or
        -not [string]::IsNullOrEmpty([string]$disk.ParentPath) -or
        [uint64]$disk.Size -lt 1GB -or [uint64]$disk.Size -gt $capacity) {
        throw 'The accepted guest image must be a standalone dynamic VHDX between 1 GiB and the requested guest capacity. Restore the pinned guest asset, then retry; existing resources were retained.'
    }
    $disk
}
function Prepare($request, $context) {
    foreach ($field in @('cpus', 'memory_mib', 'disk_gib')) {
        if ([uint64]$request.$field -ne [uint64]$context.claim.spec.$field -or [uint64]$request.$field -eq 0) {
            throw 'The requested guest resources differ from the persisted owned setup claim.'
        }
    }
    $vm = OwnedVm $context $true
    if ($null -eq $vm) {
        if ($null -ne $context.vm_id) {
            throw 'The previously registered owned guest is missing. Its setup was retained; remove this setup explicitly before creating another guest.'
        }
        $image = FullPath ([string]$request.image)
        NoRedirects $image
        if (-not (Test-Path -LiteralPath $image -PathType Leaf)) { throw 'The accepted guest image is missing. Restore the pinned guest asset, then retry.' }
        $drive = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.DeviceID -ieq [IO.Path]::GetPathRoot($context.directory).TrimEnd('\') })
        $required = [uint64]$request.disk_gib * 1GB
        $null = GuestDisk $image $required
        $seedBytes = [uint64]0
        foreach ($item in @(Get-ChildItem -LiteralPath (Join-Path $context.directory 'seed') -Recurse -File)) { $seedBytes += [uint64]$item.Length }
        $reserve = [Math]::Max([uint64]1GB, ($seedBytes + [uint64]512MB))
        if ($drive.Count -ne 1 -or [uint64]$drive[0].FreeSpace -lt ($required + $reserve)) { throw 'The selected local drive does not have enough free space for this guest. Free space there, then retry; existing resources were retained.' }
        foreach ($other in @(Get-VM)) {
            foreach ($disk in @(Get-VMHardDiskDrive -VM $other)) {
                if (-not [string]::IsNullOrEmpty([string]$disk.Path) -and
                    ((SamePath ([string]$disk.Path) $context.disk) -or
                     (SamePath ([string]$disk.Path) (Join-Path $context.directory 'disk.partial.vhdx')))) {
                    throw 'The requested guest disk is attached to another VM. Its resources were left unchanged.'
                }
            }
        }
        # With no registered guest, only this claim's exact partial outputs can be rebuilt.
        foreach ($name in @('disk.vhdx','seed.iso','disk.partial.vhdx','seed.partial.iso','serial.log')) {
            $path = Join-Path $context.directory $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        }
        $partialDisk = Join-Path $context.directory 'disk.partial.vhdx'
        try { CopyFile $image $partialDisk } catch { throw 'The accepted VHDX could not be copied. Its setup claim and any partial output were retained; free space or restore the pinned asset, then retry.' }
        $diskInfo = GuestDisk $partialDisk $required
        if ([uint64]$diskInfo.Size -lt $required) {
            try { Resize-VHD -Path $partialDisk -SizeBytes $required -ErrorAction Stop } catch { throw 'The owned guest disk could not be expanded. Its setup claim and partial output were retained; resolve the disk error, then retry.' }
            $diskInfo = GuestDisk $partialDisk $required
            if ([uint64]$diskInfo.Size -ne $required) { throw 'The owned guest disk capacity was not confirmed. Its setup claim and partial output were retained.' }
        }
        Move-Item -LiteralPath $partialDisk -Destination $context.disk
        $partialIso = Join-Path $context.directory 'seed.partial.iso'
        CreateIso (Join-Path $context.directory 'seed') $partialIso
        Move-Item -LiteralPath $partialIso -Destination $context.iso
        $switch = DefaultSwitch
        $vm = New-VM -Name $context.name -Generation 2 -MemoryStartupBytes ([uint64]$request.memory_mib * 1MB) -VHDPath $context.disk -Path (Join-Path $context.directory 'machine') -SwitchName $switch.Name
        # A crash before this tag leaves uncertain resources, never auto-adopted/deleted.
        Set-VM -VM $vm -Notes $context.tag -AutomaticStartAction Nothing -AutomaticStopAction ShutDown -CheckpointType Disabled
    }
    if ([string]$vm.State -ne 'Off') { throw 'Stop this owned bot computer before completing its preparation.' }
    Set-VMProcessor -VM $vm -Count ([int]$request.cpus)
    # Gen2 COM setup needs guest Secure Boot disabled; host security is unchanged.
    Set-VMFirmware -VM $vm -EnableSecureBoot Off
    if (@(Get-VMDvdDrive -VM $vm).Count -eq 0) { Add-VMDvdDrive -VM $vm -Path $context.iso }
    Set-VMComPort -VM $vm -Number 1 -Path $context.pipe
    $vm = OwnedVm $context
    @{ registered=$true; vm_id=[string]$vm.Id }
}

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.action -eq 'detect') {
        $result = Detect $request
    } elseif ($request.action -eq 'hash') {
        $digest = [string]$request.digest
        if ($digest -notmatch '^(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{128})$') { throw 'A pinned SHA-256 or SHA-512 digest is required.' }
        $algorithm = 'SHA256'
        if ($digest.Length -eq 128) { $algorithm = 'SHA512' }
        $hash = Get-FileHash -LiteralPath ([string]$request.path) -Algorithm $algorithm
        $result = @{ matches=([string]$hash.Hash -ieq $digest) }
    } else {
        $context = Context $request
        if ($request.action -eq 'prepare') {
            $result = Prepare $request $context
        } else {
            $vm = OwnedVm $context ($request.action -eq 'inspect')
            if ($request.action -eq 'inspect') {
                $result = @{ registered=($null -ne $vm); vm_id=$null }
                if ($null -ne $vm) { $result.vm_id = [string]$vm.Id }
            } else {
                if ($null -eq $vm) { throw 'The owned Hyper-V guest is no longer registered.' }
                switch ([string]$request.action) {
                    'state' { }
                    'start' {
                        if ([string]$vm.State -notin @('Running','Off')) { throw 'The bot computer is not stopped. Reconcile its state before starting it.' }
                        if ([string]$vm.State -eq 'Off') { Start-VM -VM $vm -Confirm:$false }
                    }
                    'stop' {
                        if ([string]$vm.State -ne 'Off') { Stop-VM -VM $vm -Confirm:$false }
                    }
                    'force_stop' {
                        if ([string]$vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Confirm:$false }
                    }
                    'unregister' {
                        if ([string]$vm.State -ne 'Off') { throw 'Stop the owned bot computer before removing its registration.' }
                        Remove-VM -VM $vm -Confirm:$false -Force
                        if ($null -ne (OwnedVm $context $true)) { throw 'Hyper-V has not confirmed removal. The setup claim was retained.' }
                    }
                    'endpoint' {
                        if ([string]$vm.State -ne 'Running') { throw 'The owned bot computer is not running.' }
                    }
                    default { throw 'Unknown Hyper-V adapter operation.' }
                }
                if ($request.action -eq 'unregister') {
                    $result = @{ removed=$true }
                } elseif ($request.action -eq 'endpoint') {
                    $addresses = @(Get-VMNetworkAdapter -VM $vm | ForEach-Object { $_.IPAddresses } | Where-Object {
                        $address = $null
                        [Net.IPAddress]::TryParse([string]$_, [ref]$address) -and $address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork
                    })
                    $result = @{ addresses=@($addresses) }
                } else {
                    $confirmed = OwnedVm $context
                    if ($null -eq $confirmed) { throw 'The owned guest disappeared before its state was confirmed.' }
                    $result = @{ state=[string]$confirmed.State }
                }
            }
        }
    }
    [Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 12))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
