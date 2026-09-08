import { useEffect } from 'react'
import { create } from 'zustand'
import { studioCommand, type StudioCatalog } from '@/services/agent/studio'

const empty: StudioCatalog = { pools: [], instances: [], usage: {} }
export const useStudioCatalogState = create<{
  catalog: StudioCatalog
  error?: string
  updatedAt?: number
}>(() => ({ catalog: empty }))
let pending: Promise<void> | undefined
let users = 0
let timer: ReturnType<typeof setTimeout> | undefined

export function refreshStudioCatalog(): Promise<void> {
  if (pending) return pending
  pending = studioCommand<StudioCatalog>('capacity')
    .then((catalog) => {
      const current = useStudioCatalogState.getState().catalog
      const unchanged = JSON.stringify(current) === JSON.stringify(catalog)
      if (unchanged && !useStudioCatalogState.getState().error) return
      useStudioCatalogState.setState({
        catalog: unchanged ? current : catalog,
        error: undefined,
        updatedAt: Date.now(),
      })
    })
    .catch((e) => {
      useStudioCatalogState.setState({ error: String(e) })
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}

function poll() {
  if (timer) clearTimeout(timer)
  if (!users || document.hidden) return
  void refreshStudioCatalog().finally(() => {
    if (timer) clearTimeout(timer)
    if (users && !document.hidden) timer = setTimeout(poll, 5000)
  })
}

export function useStudioCatalog() {
  const state = useStudioCatalogState()
  useEffect(() => {
    if (++users === 1) {
      document.addEventListener('visibilitychange', poll)
      poll()
    }
    return () => {
      if (--users === 0) {
        if (timer) clearTimeout(timer)
        document.removeEventListener('visibilitychange', poll)
      }
    }
  }, [])
  return { ...state, refresh: refreshStudioCatalog }
}
