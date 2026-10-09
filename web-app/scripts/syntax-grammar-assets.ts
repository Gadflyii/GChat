import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// Grammars and WASM are offline data assets, requested by Shiki on first use.
// Preserve the complete installed language inventory and exact regex engine.
export function syntaxGrammarAssets(): Plugin {
  const require = createRequire(import.meta.url)
  return {
    name: 'gchat-syntax-grammar-assets',
    apply: 'build',
    async transform(source, id) {
      if (id.endsWith('/shiki/dist/bundle-full.mjs')) {
        const reference = this.emitFile({
          type: 'asset', name: 'onig.wasm',
          source: await readFile(require.resolve('shiki/onig.wasm')),
        })
        return { code: source.replace("import('shiki/wasm')", `fetch(import.meta.ROLLUP_FILE_URL_${reference})`), map: null }
      }
      if (!id.endsWith('/shiki/dist/langs.mjs')) return
      const imports = [...source.matchAll(/import\('(@shikijs\/langs\/([^']+))'\)/g)]
      const sharedGrammars = new Map<string, string>()
      let result = `const grammarAssets = new Map();
function loadGrammarAsset(url) {
  let loading = grammarAssets.get(url);
  if (!loading) {
    loading = fetch(url).then(response => {
      if (!response.ok) throw new Error('Unable to load syntax grammar');
      return response.json();
    });
    grammarAssets.set(url, loading);
    loading.catch(() => grammarAssets.delete(url));
  }
  return loading;
}
` + source
      for (const [expression, moduleId] of imports) {
        const module = await import(/* @vite-ignore */ moduleId)
        const references = module.default.map((grammar: { name: string }) => {
          const data = JSON.stringify(grammar)
          let reference = sharedGrammars.get(data)
          if (!reference) {
            reference = this.emitFile({ type: 'asset', name: `syntax-${grammar.name}.json`, source: data })
            sharedGrammars.set(data, reference)
          }
          return `import.meta.ROLLUP_FILE_URL_${reference}`
        })
        // Dependencies retain their original array order and share assets across
        // languages, avoiding copies of embedded grammars such as JavaScript.
        result = result.replaceAll(expression,
          `Promise.all([${references.join(',')}].map(loadGrammarAsset)).then(grammar => ({ default: grammar }))`)
      }
      return { code: result, map: null }
    },
  }
}
