import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)

// Vite and esbuild need Node's typed-array realm, separate from the browser parser.
const bundleTerminal = String.raw`
  import { build, loadConfigFromFile } from 'vite'

  const root = process.argv[1]
  const production = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    root + 'vite.config.ts',
    root,
    'silent'
  )
  if (!production) throw new Error('Missing production Vite configuration')

  const entryId = 'virtual:gchat-terminal-production'
  const resolvedEntryId = '\0' + entryId
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    esbuild: production.config.esbuild,
    // Application plugins and route generation do not run in this isolated bundle.
    plugins: [{
      name: 'terminal-production-fixture',
      resolveId(id) {
        if (id === entryId) return resolvedEntryId
      },
      load(id) {
        if (id === resolvedEntryId) return 'export { Terminal } from "@xterm/xterm"'
      },
    }],
    build: {
      target: production.config.build?.target,
      minify: production.config.build?.minify,
      write: false,
      rollupOptions: {
        input: entryId,
        preserveEntrySignatures: 'strict',
        output: {
          format: 'iife',
          name: 'GChatTerminalFixture',
          inlineDynamicImports: true,
        },
      },
    },
  })
  const output = Array.isArray(result) ? result[0] : result
  if (!('output' in output)) throw new Error('Missing terminal bundle output')
  const entry = output.output.find((asset) => asset.type === 'chunk' && asset.isEntry)
  if (!entry || entry.type !== 'chunk') throw new Error('Missing terminal entry chunk')
  process.stdout.write(entry.code)
`

describe('production terminal runtime', () => {
  it('replies to mode queries and drains subsequent output chunks', async () => {
    const root = `${resolve(dirname(fileURLToPath(import.meta.url)), '../..')}/`
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', bundleTerminal, root],
      { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }
    )

    // No renderer is opened: this exercises the browser runtime's public parser API.
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    let terminal: Terminal | undefined
    try {
      const runtime = window.eval(`${stdout}\n; GChatTerminalFixture`) as typeof import('@xterm/xterm')
      terminal = new runtime.Terminal({ cols: 80, rows: 24 })
      const replies: string[] = []
      terminal.onData((reply) => replies.push(reply))
      const drained: number[] = []
      const chunks = [
        '\x1b[?1016$p\x1b[?2026$p\x1b[4$p\x1b[12$p\x1b[9999$p\x1b[?9999$pFIRST_DRAW\r\n',
        '\x1b[4h\x1b[4$p\x1b[?1004h\x1b[?1004$pSECOND_DRAW\r\n',
        '\x1b[4l\x1b[4$p\x1b[?1004l\x1b[?1004$pTHIRD_DRAW',
      ]
      await Promise.all(chunks.map((chunk, index) => new Promise<void>((resolve) => {
        terminal!.write(chunk, () => {
          drained.push(index)
          resolve()
        })
      })))

      expect(replies).toEqual([
        '\x1b[?1016;2$y',
        '\x1b[?2026;2$y',
        '\x1b[4;2$y',
        '\x1b[12;3$y',
        '\x1b[9999;0$y',
        '\x1b[?9999;0$y',
        '\x1b[4;1$y',
        '\x1b[?1004;1$y',
        '\x1b[4;2$y',
        '\x1b[?1004;2$y',
      ])
      expect(drained).toEqual([0, 1, 2])
      expect([0, 1, 2].map((row) => terminal!.buffer.active.getLine(row)?.translateToString(true)))
        .toEqual(['FIRST_DRAW', 'SECOND_DRAW', 'THIRD_DRAW'])
    } finally {
      terminal?.dispose()
      canvas.mockRestore()
    }
  }, 15_000)
})
