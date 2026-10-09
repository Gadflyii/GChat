import { createHighlighter } from 'shiki'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import wasmUrl from 'shiki/onig.wasm?url'
import type { BundledLanguage, BundledTheme, ShikiTransformer } from 'shiki'

// Preserve the existing Oniguruma arithmetic/regex semantics; the WASM is an
// offline bundled binary asset instead of a 622 kB base64 JavaScript module.
const highlighter = createHighlighter({
  themes: ['one-light', 'one-dark-pro'],
  langs: [],
  engine: createOnigurumaEngine(fetch(wasmUrl)), 
})

export async function codeToHtml(code: string, options: {
  lang: BundledLanguage
  theme: BundledTheme
  transformers: ShikiTransformer[]
}) {
  const instance = await highlighter
  await instance.loadLanguage(options.lang)
  return instance.codeToHtml(code, options)
}
