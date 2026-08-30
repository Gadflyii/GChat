import { Channel, invoke } from '@tauri-apps/api/core'
import type {
  OpenCodeReadiness,
  OpenCodeProvisionPhase,
  OpenCodeProvisionRequest,
  HermesProvisionRequest,
  HermesReadiness,
  TerminalEvent,
  TerminalId,
  TerminalSpawnRequest,
  TerminalStatus,
} from '@/types/terminal'

export async function attachTerminal(
  terminalId: TerminalId,
  onEvent: (event: TerminalEvent) => void
): Promise<TerminalStatus> {
  const channel = new Channel<TerminalEvent>()
  channel.onmessage = onEvent
  return invoke<TerminalStatus>('terminal_attach', {
    terminalId,
    onEvent: channel,
  })
}

export function getTerminalStatus(
  terminalId: TerminalId
): Promise<TerminalStatus> {
  return invoke<TerminalStatus>('terminal_status', { terminalId })
}

export function spawnTerminal(
  request: TerminalSpawnRequest
): Promise<TerminalStatus> {
  return invoke<TerminalStatus>('terminal_spawn', { request })
}

export function writeTerminal(
  terminalId: TerminalId,
  generation: number,
  data: Uint8Array
): Promise<void> {
  return invoke<void>('terminal_write', {
    input: { terminalId, generation, data: bytesToBase64(data) },
  })
}

export function resizeTerminal(
  terminalId: TerminalId,
  generation: number,
  rows: number,
  cols: number,
  pixelWidth: number,
  pixelHeight: number
): Promise<void> {
  return invoke<void>('terminal_resize', {
    request: {
      terminalId,
      generation,
      rows,
      cols,
      pixelWidth,
      pixelHeight,
    },
  })
}

export function setTerminalFlow(
  terminalId: TerminalId,
  generation: number,
  paused: boolean
): Promise<void> {
  return invoke<void>('terminal_set_flow', {
    request: { terminalId, generation, paused },
  })
}

export function stopTerminal(terminalId: TerminalId): Promise<TerminalStatus> {
  return invoke<TerminalStatus>('terminal_stop', { terminalId })
}

export function getOpenCodeReadiness(
  customPath?: string
): Promise<OpenCodeReadiness> {
  return invoke<OpenCodeReadiness>('opencode_readiness', {
    customPath: customPath || null,
  })
}

let activeOpenCodeProvision:
  | { key: string; promise: Promise<OpenCodeReadiness> }
  | undefined

/**
 * Own the Code tab's complete first-run path. The promise is shared while it
 * is active because React StrictMode mounts effects twice in development; an
 * installer must never be spawned twice.
 */
export function provisionOpenCode(
  request: OpenCodeProvisionRequest,
  onPhase?: (phase: OpenCodeProvisionPhase) => void
): Promise<OpenCodeReadiness> {
  // The key deliberately excludes credentials and proxy details. They remain
  // only in the request object for the lifetime of the active operation.
  const key = JSON.stringify({
    customPath: request.customPath,
    apiUrl: request.apiUrl,
    model: request.model,
  })
  if (activeOpenCodeProvision) {
    if (activeOpenCodeProvision.key === key) {
      return activeOpenCodeProvision.promise
    }
    return activeOpenCodeProvision.promise
      .catch(() => undefined)
      .then(() => provisionOpenCode(request, onPhase))
  }

  const provision = async (): Promise<OpenCodeReadiness> => {
    onPhase?.('checking')
    let readiness = await getOpenCodeReadiness(request.customPath)

    if (!readiness.installed || readiness.viaWsl) {
      if (request.customPath) {
        throw new Error(
          `The configured OpenCode executable does not exist: ${request.customPath}`
        )
      }
      onPhase?.('installing')
      await invoke<void>('install_agent', {
        agentId: 'opencode',
        proxy: request.proxy,
      })
      readiness = await getOpenCodeReadiness()
      if (!readiness.installed || readiness.viaWsl) {
        throw new Error(
          'OpenCode installation completed without a native executable on PATH.'
        )
      }
    }

    const model = request.model?.trim()
    if (!model) return readiness

    // The GChat provider is managed integration state, not user-authored
    // OpenCode configuration. Refresh it even when structurally ready so a
    // model reload can publish its current context limit and endpoint.
    onPhase?.('configuring')
    await invoke<void>('configure_opencode', {
      apiUrl: request.apiUrl,
      model,
      apiKey: request.apiKey || null,
    })
    readiness = await getOpenCodeReadiness(request.customPath)
    if (!readiness.ready) {
      throw new Error(
        `OpenCode did not accept the GChat provider configuration at ${readiness.configPath}.`
      )
    }
    return readiness
  }

  const promise = provision().finally(() => {
    if (activeOpenCodeProvision?.promise === promise) {
      activeOpenCodeProvision = undefined
    }
  })
  activeOpenCodeProvision = { key, promise }
  return promise
}

export function getHermesReadiness(
  customPath?: string
): Promise<HermesReadiness> {
  return invoke<HermesReadiness>('hermes_readiness', {
    customPath: customPath || null,
  })
}

let activeHermesProvision:
  | { key: string; promise: Promise<HermesReadiness> }
  | undefined

/** Own the embedded Hermes terminal's install and configuration readiness. */
export function provisionHermes(
  request: HermesProvisionRequest,
  onPhase?: (phase: OpenCodeProvisionPhase) => void
): Promise<HermesReadiness> {
  const key = JSON.stringify({
    customPath: request.customPath,
    apiUrl: request.apiUrl,
    model: request.model,
    contextLength: request.contextLength,
  })
  if (activeHermesProvision) {
    if (activeHermesProvision.key === key) return activeHermesProvision.promise
    return activeHermesProvision.promise
      .catch(() => undefined)
      .then(() => provisionHermes(request, onPhase))
  }

  const provision = async (): Promise<HermesReadiness> => {
    onPhase?.('checking')
    let readiness = await getHermesReadiness(request.customPath)

    if (!readiness.installed || readiness.viaWsl) {
      if (request.customPath) {
        throw new Error(
          `The configured Hermes executable does not exist: ${request.customPath}`
        )
      }
      onPhase?.('installing')
      await invoke<void>('install_agent', {
        agentId: 'hermes',
        proxy: request.proxy,
      })
      readiness = await getHermesReadiness()
      if (!readiness.installed || readiness.viaWsl) {
        throw new Error(
          'Hermes installation completed without a native executable on PATH.'
        )
      }
    }

    const model = request.model?.trim()
    if (!readiness.ready && model) {
      onPhase?.('configuring')
      await invoke<void>('configure_hermes_agent', {
        apiUrl: request.apiUrl,
        model,
        apiKey: request.apiKey || null,
        contextLength: Math.max(request.contextLength ?? 65_536, 65_536),
      })
      readiness = await getHermesReadiness(request.customPath)
    }
    if (model && !readiness.ready) {
      throw new Error(
        `Hermes did not accept the GChat provider configuration at ${readiness.configPath}.`
      )
    }
    return readiness
  }

  const promise = provision().finally(() => {
    if (activeHermesProvision?.promise === promise) {
      activeHermesProvision = undefined
    }
  })
  activeHermesProvision = { key, promise }
  return promise
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function terminalBinaryStringToBytes(data: string): Uint8Array {
  const bytes = new Uint8Array(data.length)
  for (let index = 0; index < data.length; index += 1) {
    bytes[index] = data.charCodeAt(index) & 0xff
  }
  return bytes
}
