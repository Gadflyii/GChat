import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceHub } from '@/services'
import { MODEL_LOAD_WATCHDOG_MS } from '@/lib/utils'
import {
  isExplicitSwitchPending,
  runModelStop,
  shouldAttemptAutoStart,
  splitModelLoadError,
  switchToModel,
} from './switchModel'

const { appState, localApiState, modelProviderState, startServer, stopServer } =
  vi.hoisted(() => ({
    appState: {
      serverStatus: 'running' as 'running' | 'stopped' | 'pending',
      activeModels: [] as string[],
      intentionallyStoppedModels: new Set<string>(),
      pendingModelStops: 0,
      reserveModelStop: vi.fn(() => { appState.pendingModelStops += 1 }),
      releaseModelStop: vi.fn(() => { appState.pendingModelStops -= 1 }),
      setServerStatus: vi.fn(),
      setActiveModels: vi.fn(),
      updateLoadingModel: vi.fn(),
      setIntentionalModelStop: vi.fn((provider: string, model: string, stopped: boolean) => {
        const key = `${provider}::${model}`
        if (stopped) appState.intentionallyStoppedModels.add(key)
        else appState.intentionallyStoppedModels.delete(key)
      }),
    },
    localApiState: {
      enableOnStartup: false,
      serverHost: '127.0.0.1',
      serverPort: 1337,
      apiPrefix: '/v1',
      apiKey: '',
      trustedHosts: [] as string[],
      corsEnabled: true,
      verboseLogs: false,
      proxyTimeout: 600,
      setServerPort: vi.fn(),
      setDefaultModelLocalApiServer: vi.fn(),
      setLastServerModels: vi.fn(),
    },
    modelProviderState: {
      providers: [
        {
          provider: 'ginfer',
          models: [{ id: 'broken-model' }],
        },
      ],
      selectModelProvider: vi.fn(),
    },
    startServer: vi.fn(),
    stopServer: vi.fn(),
  }))

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => appState,
  },
}))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: {
    getState: () => localApiState,
  },
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => modelProviderState,
  },
}))

vi.mock('@/hooks/useModelLoad', () => ({
  useModelLoad: {
    getState: () => ({ setModelLoadError: vi.fn() }),
  },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({ updateCurrentThreadModel: vi.fn() }),
  },
}))

vi.mock('@/utils/registerRemoteProvider', () => ({
  isKeylessRemoteProvider: vi.fn(() => false),
  registerRemoteProvider: vi.fn(),
}))

vi.mock('@/utils/activeModelsSync', () => ({
  syncActiveModelsFromEngines: vi.fn(),
}))




vi.mock('@/i18n/setup', () => ({
  default: { t: (key: string) => key },
}))

describe('switchToModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appState.serverStatus = 'running'
    appState.intentionallyStoppedModels.clear()
    appState.pendingModelStops = 0
    startServer.mockResolvedValue(1337)
    stopServer.mockResolvedValue(undefined)
    window.core = {
      api: {
        startServer,
        stopServer,
      },
    } as typeof window.core
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not start an Installed Load that was cancelled while queued', async () => {
    appState.serverStatus = 'stopped'
    let releaseStart = () => {}
    const models = {
      getActiveModels: vi.fn().mockResolvedValue(['broken-model']),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn(() => new Promise<void>((resolve) => { releaseStart = resolve })),
    }
    const serviceHub = {
      app: () => ({ getServerStatus: vi.fn().mockResolvedValue(false) }),
      models: () => models,
    } as unknown as ServiceHub
    const first = switchToModel({
      modelId: 'broken-model', providerName: 'ginfer', serviceHub,
      options: { useProfileDefaults: true },
    })
    await vi.waitFor(() => expect(models.startModel).toHaveBeenCalledOnce())

    const controller = new AbortController()
    const queued = switchToModel({
      modelId: 'queued-model', providerName: 'ginfer', serviceHub,
      options: { useProfileDefaults: true, loadOperationId: 'queued-operation' },
      signal: controller.signal,
    }).catch((error: unknown) => error)
    controller.abort()
    releaseStart()
    await first

    expect(await queued).toMatchObject({ name: 'AbortError' })
    expect(models.startModel).toHaveBeenCalledOnce()
    expect(models.stopAllModels).toHaveBeenCalledOnce()
  })

  it('keeps a scoped Installed Load pending beyond the fallback watchdog', async () => {
    vi.useFakeTimers()
    appState.serverStatus = 'stopped'
    let rejectStart = (_error: Error) => {}
    const failure = new Error('native preparation failed after its long-running profile')
    const models = {
      getActiveModels: vi.fn().mockResolvedValue([]),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectStart = reject })),
    }
    const serviceHub = {
      models: () => models,
    } as unknown as ServiceHub
    let settled = false
    const outcome = switchToModel({
      modelId: 'long-profile-model', providerName: 'ginfer', serviceHub,
      options: { useProfileDefaults: true, loadOperationId: 'long-operation' },
    }).catch((error: unknown) => error).finally(() => { settled = true })

    await vi.advanceTimersByTimeAsync(0)
    expect(models.startModel).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(MODEL_LOAD_WATCHDOG_MS + 1)
    expect(settled).toBe(false)

    rejectStart(failure)
    expect(await outcome).toBe(failure)
    expect(models.startModel).toHaveBeenCalledOnce()
  })

  it('holds the lifecycle queue until native cancellation cleanup settles', async () => {
    appState.serverStatus = 'stopped'
    const controller = new AbortController()
    let rejectStart = (_error: Error) => {}
    const models = {
      getActiveModels: vi.fn().mockResolvedValue([]),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectStart = reject })),
    }
    const serviceHub = { models: () => models } as unknown as ServiceHub
    const outcome = switchToModel({
      modelId: 'cancelled-profile-model', providerName: 'ginfer', serviceHub,
      options: { useProfileDefaults: true, loadOperationId: 'cancelled-operation' },
      signal: controller.signal,
    }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(models.startModel).toHaveBeenCalledOnce())
    controller.abort()
    const stop = vi.fn().mockResolvedValue(undefined)
    const queuedStop = runModelStop(stop)
    await Promise.resolve()
    expect(stop).not.toHaveBeenCalled()

    rejectStart(new Error('native operation cancelled'))
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    await queuedStop
    expect(stop).toHaveBeenCalledOnce()
    expect(shouldAttemptAutoStart('ginfer', 'cancelled-profile-model')).toBe(true)
  })

  it('publishes a Ready native session when it wins the cancellation race', async () => {
    appState.serverStatus = 'stopped'
    const controller = new AbortController()
    let releaseStart = () => {}
    const models = {
      getActiveModels: vi.fn().mockResolvedValue(['broken-model']),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn(() => new Promise<void>((resolve) => { releaseStart = resolve })),
    }
    const serviceHub = { models: () => models } as unknown as ServiceHub
    const pending = switchToModel({
      modelId: 'broken-model', providerName: 'ginfer', serviceHub,
      options: { useProfileDefaults: true, loadOperationId: 'ready-operation' },
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(models.startModel).toHaveBeenCalledOnce())
    controller.abort()
    releaseStart()
    await pending

    expect(appState.setActiveModels).toHaveBeenCalledWith(['broken-model'])
    expect(models.stopAllModels).toHaveBeenCalledOnce()
    expect(isExplicitSwitchPending('ginfer', 'broken-model')).toBe(false)
  })

  it('forwards the selected GPU even when the same model is already serving', async () => {
    const failure = new Error('selected GPU rejected by native admission')
    const models = {
      getActiveModels: vi.fn().mockResolvedValue(['broken-model']),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn().mockRejectedValue(failure),
    }
    const serviceHub = {
      app: () => ({ getServerStatus: vi.fn().mockResolvedValue(true) }),
      models: () => models,
    } as unknown as ServiceHub
    await expect(switchToModel({
      modelId: 'broken-model', providerName: 'ginfer', serviceHub,
      gpuUuids: ['GPU-one'],
    })).rejects.toBe(failure)
    expect(models.startModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ginfer' }), 'broken-model', true, ['GPU-one']
    )
  })

  it.each([{ gpuUuids: undefined }, { gpuUuids: ['GPU-one'] }])(
    'forwards Installed Load profile defaults for an already serving model with GPU selection $gpuUuids',
    async ({ gpuUuids }) => {
      const failure = new Error('profile admission rejected')
      const models = {
        getActiveModels: vi.fn().mockResolvedValue(['broken-model']),
        stopAllModels: vi.fn().mockResolvedValue(undefined),
        startModel: vi.fn().mockRejectedValue(failure),
      }
      const serviceHub = {
        app: () => ({ getServerStatus: vi.fn().mockResolvedValue(true) }),
        models: () => models,
      } as unknown as ServiceHub

      await expect(switchToModel({
        modelId: 'broken-model',
        providerName: 'ginfer',
        serviceHub,
        gpuUuids,
        options: { useProfileDefaults: true },
      })).rejects.toBe(failure)

      expect(models.startModel).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'ginfer' }),
        'broken-model',
        true,
        gpuUuids,
        { useProfileDefaults: true }
      )
      expect(appState.setServerStatus).toHaveBeenLastCalledWith('running')
    }
  )

  it('restores a previously running API server after model load failure', async () => {
    const models = {
      getActiveModels: vi.fn().mockResolvedValue([]),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi
        .fn()
        .mockRejectedValue(new Error('missing vision weights')),
    }
    const serviceHub = {
      app: () => ({
        getServerStatus: vi.fn().mockResolvedValue(false),
      }),
      models: () => models,
    } as unknown as ServiceHub

    await expect(
      switchToModel({
        modelId: 'broken-model',
        providerName: 'ginfer',
        serviceHub,
      })
    ).rejects.toThrow('missing vision weights')

    expect(stopServer).toHaveBeenCalledOnce()
    expect(startServer).toHaveBeenCalledOnce()
    expect(appState.setServerStatus).toHaveBeenLastCalledWith('running')
  })

  it('blocks the auto-start path while an explicit switch for the same target is in flight', async () => {
    let releaseStart = () => {}
    const startModel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve
        })
    )
    const models = {
      getActiveModels: vi.fn().mockResolvedValue(['ready-model']),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel,
    }
    const serviceHub = {
      app: () => ({
        getServerStatus: vi.fn().mockResolvedValue(false),
      }),
      models: () => models,
    } as unknown as ServiceHub

    const pending = switchToModel({
      modelId: 'ready-model',
      providerName: 'ginfer',
      serviceHub,
    })
    await vi.waitFor(() => expect(startModel).toHaveBeenCalled())

    // ChatInput's effect fires on the same selection change that started this
    // switch; it must not probe the engines and queue a duplicate switch.
    expect(isExplicitSwitchPending('ginfer', 'ready-model')).toBe(true)
    expect(shouldAttemptAutoStart('ginfer', 'ready-model')).toBe(false)
    // A different target is untouched by the marker.
    expect(shouldAttemptAutoStart('ginfer', 'other-model')).toBe(true)

    releaseStart()
    await pending

    expect(isExplicitSwitchPending('ginfer', 'ready-model')).toBe(false)
    expect(shouldAttemptAutoStart('ginfer', 'ready-model')).toBe(true)
  })

  it('keeps an intentionally stopped model out of the automatic switch queue', async () => {
    appState.setIntentionalModelStop('ginfer', 'ready-model', true)
    const models = {
      getActiveModels: vi.fn().mockResolvedValue([]),
      stopAllModels: vi.fn(),
      startModel: vi.fn(),
    }
    const serviceHub = {
      app: () => ({ getServerStatus: vi.fn().mockResolvedValue(true) }),
      models: () => models,
    } as unknown as ServiceHub

    expect(shouldAttemptAutoStart('ginfer', 'ready-model')).toBe(false)
    await switchToModel({
      modelId: 'ready-model', providerName: 'ginfer', serviceHub, isAutoStart: true,
    })
    expect(models.stopAllModels).not.toHaveBeenCalled()
    expect(models.startModel).not.toHaveBeenCalled()
    expect(shouldAttemptAutoStart('ginfer', 'other-model')).toBe(true)

    models.getActiveModels.mockResolvedValue(['ready-model'])
    await switchToModel({ modelId: 'ready-model', providerName: 'ginfer', serviceHub })
    expect(appState.intentionallyStoppedModels.has('ginfer::ready-model')).toBe(false)
    expect(shouldAttemptAutoStart('ginfer', 'ready-model')).toBe(true)
  })

  it('reserves Stop behind an in-flight start and suppresses automatic starts', async () => {
    let releaseStart = () => {}
    const models = {
      getActiveModels: vi.fn().mockResolvedValue(['ready-model']),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn(() => new Promise<void>((resolve) => { releaseStart = resolve })),
    }
    const serviceHub = {
      app: () => ({ getServerStatus: vi.fn().mockResolvedValue(false) }),
      models: () => models,
    } as unknown as ServiceHub
    const start = switchToModel({
      modelId: 'ready-model', providerName: 'ginfer', serviceHub, isAutoStart: true,
    })
    await vi.waitFor(() => expect(models.startModel).toHaveBeenCalledOnce())
    const stopCanProceed = vi.fn()
    const waiting = runModelStop(async () => {
      stopCanProceed()
      appState.setIntentionalModelStop('ginfer', 'ready-model', true)
    })
    expect(stopCanProceed).not.toHaveBeenCalled()
    expect(shouldAttemptAutoStart('ginfer', 'ready-model')).toBe(false)
    await switchToModel({
      modelId: 'ready-model', providerName: 'ginfer', serviceHub, isAutoStart: true,
    })
    expect(models.startModel).toHaveBeenCalledOnce()

    releaseStart()
    await Promise.all([start, waiting])
    expect(stopCanProceed).toHaveBeenCalledOnce()
    expect(shouldAttemptAutoStart('ginfer', 'ready-model')).toBe(false)
  })

  it('stops waiting once the engine reports the freshly started model', async () => {
    const models = {
      getActiveModels: vi.fn().mockResolvedValue(['ready-model']),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn().mockResolvedValue(undefined),
    }
    const serviceHub = {
      app: () => ({
        getServerStatus: vi.fn().mockResolvedValue(false),
      }),
      models: () => models,
    } as unknown as ServiceHub

    const startedAt = Date.now()
    await switchToModel({
      modelId: 'ready-model',
      providerName: 'ginfer',
      serviceHub,
    })

    // Previously every local switch paid a flat 500ms sleep here.
    expect(Date.now() - startedAt).toBeLessThan(400)
    expect(appState.setServerStatus).toHaveBeenLastCalledWith('running')
  })

  it('still waits out the settle budget when the engine has not come up', async () => {
    const models = {
      getActiveModels: vi.fn().mockResolvedValue([]),
      stopAllModels: vi.fn().mockResolvedValue(undefined),
      startModel: vi.fn().mockResolvedValue(undefined),
    }
    const serviceHub = {
      app: () => ({
        getServerStatus: vi.fn().mockResolvedValue(false),
      }),
      models: () => models,
    } as unknown as ServiceHub

    const startedAt = Date.now()
    await switchToModel({
      modelId: 'slow-model',
      providerName: 'ginfer',
      serviceHub,
    })

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(450)
  })
})

describe('splitModelLoadError', () => {
  it('separates the engine reason from the log it dumped after it', () => {
    const { summary, details } = splitModelLoadError({
      code: 'LLAMA_CPP_PROCESS_ERROR',
      message:
        'The model process crashed unexpectedly (access violation / segfault).\n' +
        'GGML_ASSERT(n_outputs_max <= cparams.n_outputs_max) failed\n' +
        'libggml-base.0.dylib 0x0000000105c13f0 [LLAMA_CPP_PROCESS_ERROR]',
    })

    expect(summary).toBe(
      'The model process crashed unexpectedly (access violation / segfault).'
    )
    expect(details).toContain('GGML_ASSERT')
    expect(details).not.toContain('[LLAMA_CPP_PROCESS_ERROR]')
  })

  it('prefers the structured details field over the flattened message', () => {
    const { summary, details } = splitModelLoadError({
      message: 'Model architecture is not supported.\nignored copy',
      details: 'load_hparams: unknown model architecture',
    })

    expect(summary).toBe('Model architecture is not supported.')
    expect(details).toBe('load_hparams: unknown model architecture')
  })

  it('demotes a one-line wall of text to the details pane', () => {
    const wall = `Something broke ${'and kept going '.repeat(40)}`

    const { summary, details } = splitModelLoadError({ message: wall })

    expect(summary.length).toBeLessThanOrEqual(201)
    expect(summary.endsWith('…')).toBe(true)
    expect(details).toBe(wall.trim())
  })

  it('leaves a short reason without a details pane', () => {
    expect(splitModelLoadError({ message: 'Model file not found.' })).toEqual({
      summary: 'Model file not found.',
      details: undefined,
    })
  })
})
