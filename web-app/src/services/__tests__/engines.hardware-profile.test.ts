import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { hardwareProfile, type EngineHardwareProfile } from '@/services/engines'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('Host-owned hardware profile actions', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it.each(['ensure', 'refresh', 'resume', 'cancel'] as const)(
    'routes %s to the selected Host without caller paths or commands', async action => {
      const status: EngineHardwareProfile = {
        status: 'interrupted', job_id: 'profile-job', pid: null, reprofile: true,
        started_unix_ms: 100, finished_unix_ms: 200,
        profile_path: '/host-owned/hardware-profile.json', checkpoint_available: true,
        gpu_uuids: ['GPU-B', 'GPU-A'], engine_path: '/host-owned/bin/ginfer',
        pending_gpu_groups: [['GPU-C']], stale_groups: [{ gpu_uuids: ['GPU-C'],
          profile_path: '/host-owned/hardware-profiles/other.json', expected_duration_ms: 1800000 }],
        diagnostic_tail: 'Interrupted measurement', error: null, available: true,
      }
      vi.mocked(invoke).mockResolvedValue(status)

      const gpuUuids = action === 'ensure' || action === 'refresh' ? ['GPU-B', 'GPU-A'] : undefined
      expect(await hardwareProfile('selected-host', action, gpuUuids)).toBe(status)
      expect(invoke).toHaveBeenCalledExactlyOnceWith('engine_hosts_command', {
        action: 'hardware_profile', args: { host_id: 'selected-host',
          body: { action, ...(gpuUuids === undefined ? {} : { gpu_uuids: ['GPU-B', 'GPU-A'] }) } },
      })
    },
  )

  it.each([
    'Stop active models before refreshing the hardware profile',
    'Hardware profiling handoff did not respond; inspect Host status before retrying',
  ])('retains admission failure without retrying or changing actions: %s', async message => {
    const error = new Error(message)
    vi.mocked(invoke).mockRejectedValue(error)

    await expect(hardwareProfile('selected-host', 'refresh', ['GPU-B', 'GPU-A'])).rejects.toBe(error)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
