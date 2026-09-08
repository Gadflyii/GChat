import { useEffect } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'

/** Passive intake; discovery never pairs a host or starts inference. */
export function EngineDiscovery() {
  const enabled = useEngineDiscovery((s) => s.enabled)
  useEffect(() => {
    if (isTauri()) void useEngineHosts.getState().discover(enabled)
  }, [enabled])
  useEffect(() => {
    if (!isTauri()) return
    let stopped = false
    const update = async () => {
      if (stopped) return
      try {
        await useEngineHosts.getState().refresh()
        const { hosts, nearby } = useEngineHosts.getState()
        const preferences = useEngineDiscovery.getState()
        if (stopped || !preferences.enabled) return
        for (const host of nearby) {
          if (preferences.ignored[host.host_id] || preferences.notified.includes(host.host_id) || hosts.some((h) => h.host_id === host.host_id)) continue
          preferences.markNotified(host.host_id)
          toast.info(`GInfer host found: ${host.name}`, { description: 'Open Engines to pair and view its models.' })
        }
      } catch (error) { console.warn('Engine registry refresh:', String(error)) }
    }
    void update()
    const timer = setInterval(() => void update(), 5000)
    return () => { stopped = true; clearInterval(timer) }
  }, [])
  return null
}
