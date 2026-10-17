import { create } from 'zustand'
import { ExtensionManager } from '@/lib/extension'
import {
  ExtensionTypeEnum,
  type RAGExtension,
  type SettingComponentProps,
} from '@gchat/core'

export type AttachmentsSettings = {
  enabled: boolean
  maxFileSizeMB: number
  retrievalLimit: number
  retrievalThreshold: number
  chunkSizeChars: number
  overlapChars: number
  searchMode: 'auto' | 'ann' | 'linear'
  parseMode: 'auto' | 'inline' | 'embeddings' | 'prompt'
  autoInlineContextRatio: number
}

type AttachmentsStore = AttachmentsSettings & {
  settingsDefs: SettingComponentProps[]
  loadSettingsDefs: () => Promise<boolean>
  saveSettings: (values: Partial<AttachmentsSettings>) => Promise<void>
  setEnabled: (v: boolean) => Promise<void>
  setMaxFileSizeMB: (v: number) => Promise<void>
  setRetrievalLimit: (v: number) => Promise<void>
  setRetrievalThreshold: (v: number) => Promise<void>
  setChunkSizeChars: (v: number) => Promise<void>
  setOverlapChars: (v: number) => Promise<void>
  setSearchMode: (v: 'auto' | 'ann' | 'linear') => Promise<void>
  setParseMode: (v: 'auto' | 'inline' | 'embeddings' | 'prompt') => Promise<void>
  setAutoInlineContextRatio: (v: number) => Promise<void>
}

const settingKeys: Record<keyof AttachmentsSettings, string> = {
  enabled: 'enabled',
  maxFileSizeMB: 'max_file_size_mb',
  retrievalLimit: 'retrieval_limit',
  retrievalThreshold: 'retrieval_threshold',
  chunkSizeChars: 'chunk_size_chars',
  overlapChars: 'overlap_chars',
  searchMode: 'search_mode',
  parseMode: 'parse_mode',
  autoInlineContextRatio: 'auto_inline_context_ratio',
}

const getRagExtension = (): RAGExtension | undefined => {
  try {
    return ExtensionManager.getInstance().get<RAGExtension>(
      ExtensionTypeEnum.RAG
    )
  } catch {
    return undefined
  }
}

export const useAttachments = create<AttachmentsStore>()((set, get) => {
  // The extension updates its entire stored schema. Serialize reads and writes so
  // separate controls cannot overwrite each other, and a remount sees flushed edits.
  let settingsQueue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = settingsQueue.then(operation)
    settingsQueue = result.catch(() => undefined)
    return result
  }

  return {
    enabled: true,
    maxFileSizeMB: 20,
    retrievalLimit: 3,
    retrievalThreshold: 0.3,
    chunkSizeChars: 512,
    overlapChars: 64,
    searchMode: 'auto',
    parseMode: 'auto',
    autoInlineContextRatio: 0.75,
    settingsDefs: [],
    loadSettingsDefs: () =>
      enqueue(async () => {
        const ext = getRagExtension()
        if (!ext?.getSettings) return false
        try {
          const defs = await ext.getSettings()
          if (!Array.isArray(defs)) return false

          const map = new Map<string, unknown>()
          defs.forEach((setting) =>
            map.set(setting.key, setting?.controllerProps?.value)
          )

          set((prev) => ({
            settingsDefs: defs,
            enabled: (map.get('enabled') as boolean | undefined) ?? prev.enabled,
            maxFileSizeMB:
              (map.get('max_file_size_mb') as number | undefined) ??
              prev.maxFileSizeMB,
            retrievalLimit:
              (map.get('retrieval_limit') as number | undefined) ??
              prev.retrievalLimit,
            retrievalThreshold:
              (map.get('retrieval_threshold') as number | undefined) ??
              prev.retrievalThreshold,
            chunkSizeChars:
              (map.get('chunk_size_chars') as number | undefined) ??
              (map.get('chunk_size_tokens') as number | undefined) ??
              prev.chunkSizeChars,
            overlapChars:
              (map.get('overlap_chars') as number | undefined) ??
              (map.get('overlap_tokens') as number | undefined) ??
              prev.overlapChars,
            searchMode:
              (map.get('search_mode') as 'auto' | 'ann' | 'linear' | undefined) ??
              prev.searchMode,
            parseMode:
              (map.get('parse_mode') as
                | 'auto'
                | 'inline'
                | 'embeddings'
                | 'prompt'
                | undefined) ?? prev.parseMode,
            autoInlineContextRatio:
              (map.get('auto_inline_context_ratio') as number | undefined) ??
              prev.autoInlineContextRatio,
          }))

          return true
        } catch (e) {
          console.debug('Failed to load attachment settings defs:', e)
          return false
        }
      }),
    saveSettings: (updates) => {
      const values = { ...updates }
      return enqueue(async () => {
        const changes = (Object.keys(values) as (keyof AttachmentsSettings)[]).map(
          (key) =>
            ({
              key: settingKeys[key],
              controllerProps: { value: values[key] },
            }) as Partial<SettingComponentProps>
        )
        if (changes.length === 0) return

        const ext = getRagExtension()
        if (ext?.updateSettings) await ext.updateSettings(changes)
        const changedValues = new Map(
          changes.map((change) => [change.key, change.controllerProps?.value])
        )
        set((state) => ({
          ...values,
          settingsDefs: state.settingsDefs.map((def) =>
            changedValues.has(def.key)
              ? ({
                  ...def,
                  controllerProps: {
                    ...def.controllerProps,
                    value: changedValues.get(def.key),
                  },
                } as SettingComponentProps)
              : def
          ),
        }))
      })
    },
    setEnabled: (value) => get().saveSettings({ enabled: !!value }),
    setMaxFileSizeMB: (value) => get().saveSettings({ maxFileSizeMB: value }),
    setRetrievalLimit: (value) => get().saveSettings({ retrievalLimit: value }),
    setRetrievalThreshold: (value) =>
      get().saveSettings({ retrievalThreshold: value }),
    setChunkSizeChars: (value) => get().saveSettings({ chunkSizeChars: value }),
    setOverlapChars: (value) => get().saveSettings({ overlapChars: value }),
    setSearchMode: (value) => get().saveSettings({ searchMode: value }),
    setParseMode: (value) => get().saveSettings({ parseMode: value }),
    setAutoInlineContextRatio: (value) =>
      get().saveSettings({ autoInlineContextRatio: value }),
  }
})

// Attempt to hydrate settings from the RAG extension, retrying briefly until it is registered
const MAX_INIT_ATTEMPTS = 5
const INIT_RETRY_DELAY_MS = 300
;(async () => {
  for (let i = 0; i < MAX_INIT_ATTEMPTS; i += 1) {
    const success = await useAttachments.getState().loadSettingsDefs()
    if (success) return
    await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAY_MS))
  }
})()
