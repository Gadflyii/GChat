export type TerminalId = 'code' | `code:${string}` | 'hermes'

export type CodeBridgePolicy = {
  origin_session_id?: string
  auto_approve: boolean
  disabled_tools: string[]
  external_roots: Array<{ path: string; can_edit: boolean }>
}

export type TerminalLaunch = 'shell' | 'open_code' | 'hermes'

export type TerminalAppearance = 'dark' | 'light'

export type TerminalPhase = 'idle' | 'running' | 'stopping' | 'exited'

export type TerminalStatus = {
  phase: TerminalPhase
  generation: number
  sequence: number
  cwd?: string
  launch?: TerminalLaunch
  exitCode?: number
  signal?: string
  replayComplete: boolean
}

export type TerminalEvent =
  | {
      type: 'started'
      generation: number
      sequence: number
      status: TerminalStatus
    }
  | {
      type: 'output'
      generation: number
      sequence: number
      data: string
    }
  | {
      type: 'exited'
      generation: number
      sequence: number
      status: TerminalStatus
    }
  | {
      type: 'replay_unavailable'
      generation: number
      sequence: number
    }
  | {
      type: 'error'
      generation: number
      sequence: number
      message: string
      status: TerminalStatus
    }

export type OpenCodeReadinessReason =
  | 'not_installed'
  | 'wsl_only'
  | 'missing_configuration'
  | 'invalid_configuration'

export type OpenCodeReadiness = {
  ready: boolean
  installed: boolean
  configured: boolean
  viaWsl: boolean
  configPath: string
  reason?: OpenCodeReadinessReason
}

export type OpenCodeProvisionPhase = 'checking' | 'installing' | 'configuring'

export type OpenCodeProvisionRequest = {
  customPath?: string
  apiUrl: string
  model?: string
  apiKey?: string
  proxy?: {
    url: string
    username?: string
    password?: string
    no_proxy?: string
  }
}

export type HermesReadiness = OpenCodeReadiness

export type HermesProvisionRequest = OpenCodeProvisionRequest & {
  contextLength?: number
}

export type TerminalSpawnRequest = {
  terminalId: TerminalId
  cwd: string
  rows: number
  cols: number
  launch: TerminalLaunch
  executable?: string
  appearance?: TerminalAppearance
  codeSessionId?: string
  bridgePolicy?: CodeBridgePolicy
}
