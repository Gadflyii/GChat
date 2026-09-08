import { create } from 'zustand'
import { engineCommand } from '@/services/engines'
import type { ModelDownload } from '@/lib/model-release'
import { getServiceHub, isServiceHubInitialized } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { AppEvent, events } from '@gchat/core'

let pending: Promise<void> | null = null
let installedSnapshot = ''
const requested = new Set<string>()
type State = { jobs: ModelDownload[]; error: string | null; acknowledge: (job: ModelDownload) => void; refresh: () => Promise<void> }
export const useLocalModelDownloads = create<State>((set, get) => ({
  jobs: [], error: null,
  acknowledge: job => { if (job.status !== 'installed') requested.add(job.id) },
  refresh: () => {
    if (pending) return pending
    pending = (async () => {
      try {
        const jobs = await engineCommand<ModelDownload[]>('local_model_downloads')
        const newlyInstalled = jobs.filter(job => job.status === 'installed' && (requested.has(job.id) || get().jobs.some(previous => previous.id === job.id && previous.status !== 'installed')))
        const installed = jobs.filter(j => j.status === 'installed').map(j => j.id).join(':')
        if (installed !== installedSnapshot && isServiceHubInitialized()) {
          useModelProvider.getState().setProviders(await getServiceHub().providers().getProviders())
          installedSnapshot = installed
        }
        if (JSON.stringify(jobs) !== JSON.stringify(get().jobs) || get().error) set({ jobs, error: null })
        for (const job of newlyInstalled) {
          requested.delete(job.id)
          events.emit(AppEvent.onModelImported, {
          modelId: job.release.sha256, modelPath: job.path, size_bytes: job.release.bytes,
          model_sha256: job.release.sha256, model_size_bytes: job.release.bytes, source: 'local',
          })
        }
      } catch (e) { set({ error: String(e) }); throw e }
    })().finally(() => { pending = null })
    return pending
  },
}))
