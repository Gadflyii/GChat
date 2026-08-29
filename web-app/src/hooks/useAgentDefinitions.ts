import { useCallback, useEffect, useState } from 'react'
import {
  listAgentDefinitions,
  newAgentDefinition,
  saveAgentDefinition,
  deleteAgentDefinition,
} from '@/services/agent/definitions'
import type { AgentDefinition } from '@/types/agent'

export function useAgentDefinitions(enabled = true) {
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDefinitions(await listAgentDefinitions())
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  const save = useCallback(async (definition: AgentDefinition) => {
    const saved = await saveAgentDefinition(definition)
    setDefinitions((current) => {
      const exists = current.some((candidate) => candidate.id === saved.id)
      const next = exists
        ? current.map((candidate) =>
            candidate.id === saved.id ? saved : candidate
          )
        : [...current, saved]
      return next.sort((left, right) => left.name.localeCompare(right.name))
    })
    return saved
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteAgentDefinition(id)
    setDefinitions((current) =>
      current.filter((definition) => definition.id !== id)
    )
  }, [])

  const createDraft = useCallback(() => newAgentDefinition(), [])

  return { definitions, loading, error, load, save, remove, createDraft }
}
