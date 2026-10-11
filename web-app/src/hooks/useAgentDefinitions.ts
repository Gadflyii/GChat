import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listAgentDefinitions,
  newAgentDefinition,
  saveAgentDefinition,
  deleteAgentDefinition,
  onAgentDefinitionsChanged,
} from '@/services/agent/definitions'
import type { AgentDefinition } from '@/types/agent'

export function useAgentDefinitions(enabled = true) {
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(null)
    try {
      const next = await listAgentDefinitions()
      if (sequence === loadSequence.current) setDefinitions(next)
    } catch (reason) {
      if (sequence === loadSequence.current) setError(String(reason))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let disposed = false
    let unlisten: (() => void) | undefined
    setLoading(true)
    // Subscribe first, then fetch: writes during asynchronous registration are
    // included in the initial snapshot, and later writes invalidate old loads.
    void onAgentDefinitionsChanged(() => {
      if (!disposed) void load()
    }).then((stop) => {
      if (disposed) {
        stop()
        return
      }
      unlisten = stop
      void load()
    }).catch((reason) => {
      if (!disposed) {
        setError(String(reason))
        setLoading(false)
      }
    })
    return () => {
      disposed = true
      ++loadSequence.current
      unlisten?.()
    }
  }, [enabled, load])

  const save = useCallback(async (definition: AgentDefinition) => {
    const saved = await saveAgentDefinition(definition)
    await load()
    return saved
  }, [load])

  const remove = useCallback(async (id: string) => {
    await deleteAgentDefinition(id)
    await load()
  }, [load])

  const createDraft = useCallback(() => newAgentDefinition(), [])

  return { definitions, loading, error, load, save, remove, createDraft }
}
