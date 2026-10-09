import { useAppState } from '@/hooks/useAppState'
import type { ServiceHub } from '@/services'
import { ensureLocalApiServerRunning } from '@/utils/ensureLocalApiServerRunning'
import {
  isKeylessRemoteProvider,
  isLocalProvider,
  registerRemoteProvider,
} from '@/utils/registerRemoteProvider'

let readinessQueue: Promise<void> = Promise.resolve()

async function reconcileRemoteProvider(
  provider: ModelProvider,
  serviceHub: Pick<ServiceHub, 'app'>,
  current: () => boolean
): Promise<void> {
  if (isLocalProvider(provider.provider)) return

  if (!provider.base_url?.trim()) {
    throw new Error(
      `Remote provider "${provider.provider}" has no configured base URL.`
    )
  }

  if (!provider.api_key?.trim() && !isKeylessRemoteProvider(provider)) {
    throw new Error(
      `Remote provider "${provider.provider}" has no configured API key.`
    )
  }

  const registered = await registerRemoteProvider(provider)
  if (!registered) {
    throw new Error(
      `Remote provider "${provider.provider}" could not be registered.`
    )
  }

  await ensureLocalApiServerRunning(serviceHub, current)
}

export function ensureRemoteProviderReady(
  provider: ModelProvider,
  serviceHub: Pick<ServiceHub, 'app'>
): Promise<void> {
  const stopSequence = useAppState.getState().modelStopSequence
  const current = () => useAppState.getState().pendingModelStops === 0 &&
    useAppState.getState().modelStopSequence === stopSequence
  const reconciliation = readinessQueue.then(() =>
    reconcileRemoteProvider(provider, serviceHub, current)
  )
  readinessQueue = reconciliation.catch(() => undefined)
  return reconciliation
}
