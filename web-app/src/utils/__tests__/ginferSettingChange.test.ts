import { describe, it, expect, vi, beforeEach } from 'vitest'
import { afterGinferSettingSaved } from '../ginferSettingChange'
import { useConfirmStore, settleConfirm } from '@/lib/confirm'
import { ginferRestartKeys } from '@/lib/ginfer-settings-labels'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('afterGinferSettingSaved', () => {
  beforeEach(() => settleConfirm(false))

  it.each(['timeout', 'auto_unload', 'model_path'])(
    'live setting %s never prompts or restarts',
    async (key) => {
      const restart = vi.fn()
      const done = await afterGinferSettingSaved({ key, activeModelIds: ['m'], restart })
      expect(done).toBe(false)
      expect(useConfirmStore.getState().pending).toBeNull()
      expect(restart).not.toHaveBeenCalled()
    }
  )

  it('classifies start arguments as restart-required, including Vision', () => {
    for (const k of ['vision', 'spec', 'kv_dtype', 'max_concurrency', 'binary_path']) {
      expect(ginferRestartKeys.has(k)).toBe(true)
    }
    expect(ginferRestartKeys.has('timeout')).toBe(false)
  })

  it('restart-required with no running model does not prompt', async () => {
    const restart = vi.fn()
    expect(await afterGinferSettingSaved({ key: 'vision', activeModelIds: [], restart })).toBe(false)
    expect(useConfirmStore.getState().pending).toBeNull()
  })

  it('restart-required asks first and restarts only on Restart now', async () => {
    const restart = vi.fn().mockResolvedValue(undefined)
    const p = afterGinferSettingSaved({ key: 'spec', activeModelIds: ['a', 'b'], restart })
    await flush()
    const pending = useConfirmStore.getState().pending!
    expect(pending.message).toBe('This change takes effect after the model restarts. Restart now?')
    expect(pending.confirmLabel).toBe('Restart now')
    expect(pending.cancelLabel).toBe('Later')
    expect(restart).not.toHaveBeenCalled()
    settleConfirm(true)
    expect(await p).toBe(true)
    expect(restart.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('Later leaves the running model alone', async () => {
    const restart = vi.fn()
    const p = afterGinferSettingSaved({ key: 'spec', activeModelIds: ['a'], restart })
    await flush()
    settleConfirm(false)
    expect(await p).toBe(false)
    expect(restart).not.toHaveBeenCalled()
  })
})
