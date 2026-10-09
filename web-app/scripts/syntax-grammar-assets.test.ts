import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { syntaxGrammarAssets } from './syntax-grammar-assets'

const require = createRequire(import.meta.url)

describe('offline syntax assets', () => {
  it('reconstructs every supported grammar exactly and shares embedded data', async () => {
    const id = require.resolve('shiki/langs')
    const source = await readFile(id, 'utf8')
    const assets: string[] = []
    const transform = syntaxGrammarAssets().transform
    if (typeof transform !== 'function') throw new Error('Missing syntax transform')
    const result = await transform.call({ emitFile: (asset: { source: string }) => {
      assets.push(asset.source)
      return String(assets.length - 1)
    } } as never, source, id) as { code: string }
    const rewritten = result.code
      .replace(/import\.meta\.ROLLUP_FILE_URL_(\d+)/g, '"$1"')
      .replace(/export \{[^}]+\};?/, '')
    const fetchAsset = vi.fn(async (url: string) => ({ ok: true, json: async () => JSON.parse(assets[Number(url)]) }))
    const languages = new Function('fetch', `${rewritten}; return bundledLanguages;`)(fetchAsset)
    const original = await import('shiki/langs')
    expect(Object.keys(languages)).toEqual(Object.keys(original.bundledLanguages))
    for (const language of original.bundledLanguagesInfo) {
      const actual = await languages[language.id]()
      const expected = await original.bundledLanguages[language.id]()
      expect(actual.default).toEqual(expected.default)
    }
    expect(new Set(assets).size).toBe(assets.length)
    const failingLanguages = new Function('fetch', `${rewritten}; return bundledLanguages;`)(async () => ({ ok: false }))
    await expect(failingLanguages.json()).rejects.toThrow('Unable to load syntax grammar')
  })

  it('loads the original WASM bytes instead of the base64 JavaScript payload', async () => {
    const id = require.resolve('shiki/bundle/full')
    const source = await readFile(id, 'utf8')
    let asset: Uint8Array | undefined
    const transform = syntaxGrammarAssets().transform
    if (typeof transform !== 'function') throw new Error('Missing syntax transform')
    await transform.call({ emitFile: (value: { source: Uint8Array }) => {
      asset = value.source
      return 'wasm'
    } } as never, source, id)
    expect(asset).toEqual(await readFile(require.resolve('shiki/onig.wasm')))
  })
})
