import { bundledLanguages, bundledLanguagesInfo } from 'shiki/langs'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import type { DiagramPlugin } from '@streamdown/mermaid'

const aliases = Object.fromEntries(bundledLanguagesInfo.flatMap(language =>
  (language.aliases ?? []).map(alias => [alias, language.id])))
const languages = new Set(Object.keys(bundledLanguages))
let codeModule: Promise<typeof import('@streamdown/code')> | undefined

// Streamdown already accepts asynchronous highlight results. Load the regex
// engine only for a fenced code block and retain its own token cache/callbacks.
export const code: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => [...languages] as ReturnType<CodeHighlighterPlugin['getSupportedLanguages']>,
  getThemes: () => ['github-light', 'github-dark'],
  supportsLanguage: language => {
    const normalized = language.trim().toLowerCase()
    return languages.has(aliases[normalized] ?? normalized)
  },
  highlight(options, callback) {
    codeModule ??= import('@streamdown/code')
    void codeModule.then(({ code: plugin }) => {
      const result = plugin.highlight(options, callback)
      if (result) callback?.(result)
    }).catch(error => console.error('[GChat Code] Failed to load highlighter:', error))
    return null
  },
}

// Diagram rendering is already asynchronous; ordinary prose does not need the
// Mermaid parser or diagram layout modules.
export const mermaid: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid(config) {
    let currentConfig = config
    return {
      initialize(nextConfig) { currentConfig = nextConfig },
      async render(id, source) {
        const { createMermaidPlugin } = await import('@streamdown/mermaid')
        return createMermaidPlugin().getMermaid(currentConfig).render(id, source)
      },
    }
  },
}
