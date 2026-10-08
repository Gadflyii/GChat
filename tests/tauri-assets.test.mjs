import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stageTauriAssets } from '../scripts/stage-tauri-assets.mjs'

test('desktop staging replaces obsolete extensions and preserves native helpers', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gchat-assets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'pre-install')
  const resources = path.join(root, 'src-tauri', 'resources')
  const destination = path.join(resources, 'pre-install')
  const bin = path.join(resources, 'bin')
  for (const directory of [source, destination, bin]) {
    mkdirSync(directory, { recursive: true })
  }
  const archives = {
    'gchat-ginfer-extension-0.1.1.tgz': Buffer.from([0, 12, 255]),
    'gchat-download-extension-1.0.0.tgz': Buffer.from('current extension'),
  }
  for (const [name, bytes] of Object.entries(archives)) {
    writeFileSync(path.join(source, name), bytes)
  }
  writeFileSync(path.join(source, 'README.md'), 'producer note')
  writeFileSync(path.join(destination, 'gchat-ginfer-extension-0.1.0.tgz'), 'obsolete')
  writeFileSync(path.join(bin, 'bun.exe'), 'accepted helper')
  writeFileSync(path.join(root, 'LICENSE'), 'current license')

  stageTauriAssets(root)

  assert.deepEqual(readdirSync(destination).sort(), Object.keys(archives).sort())
  for (const [name, bytes] of Object.entries(archives)) {
    assert.deepEqual(readFileSync(path.join(destination, name)), bytes)
  }
  assert.equal(readFileSync(path.join(resources, 'LICENSE'), 'utf8'), 'current license')
  assert.equal(readFileSync(path.join(bin, 'bun.exe'), 'utf8'), 'accepted helper')
})
