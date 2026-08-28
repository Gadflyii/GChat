import { Channel, invoke } from '@tauri-apps/api/core'
import type {
  OpenCodeReadiness,
  TerminalEvent,
  TerminalSpawnRequest,
  TerminalStatus,
} from '@/types/terminal'

export async function attachTerminal(
  onEvent: (event: TerminalEvent) => void
): Promise<TerminalStatus> {
  const channel = new Channel<TerminalEvent>()
  channel.onmessage = onEvent
  return invoke<TerminalStatus>('terminal_attach', { onEvent: channel })
}

export function getTerminalStatus(): Promise<TerminalStatus> {
  return invoke<TerminalStatus>('terminal_status')
}

export function spawnTerminal(
  request: TerminalSpawnRequest
): Promise<TerminalStatus> {
  return invoke<TerminalStatus>('terminal_spawn', { request })
}

export function writeTerminal(
  generation: number,
  data: Uint8Array
): Promise<void> {
  return invoke<void>('terminal_write', {
    input: { generation, data: bytesToBase64(data) },
  })
}

export function resizeTerminal(
  generation: number,
  rows: number,
  cols: number,
  pixelWidth: number,
  pixelHeight: number
): Promise<void> {
  return invoke<void>('terminal_resize', {
    request: { generation, rows, cols, pixelWidth, pixelHeight },
  })
}

export function setTerminalFlow(
  generation: number,
  paused: boolean
): Promise<void> {
  return invoke<void>('terminal_set_flow', {
    request: { generation, paused },
  })
}

export function stopTerminal(): Promise<TerminalStatus> {
  return invoke<TerminalStatus>('terminal_stop')
}

export function getOpenCodeReadiness(
  customPath?: string
): Promise<OpenCodeReadiness> {
  return invoke<OpenCodeReadiness>('opencode_readiness', {
    customPath: customPath || null,
  })
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
