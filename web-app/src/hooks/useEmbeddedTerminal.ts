import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import { TerminalFlowController } from '@/lib/codeTerminal'
import {
  attachTerminal,
  base64ToBytes,
  resizeTerminal,
  setTerminalFlow,
  terminalBinaryStringToBytes,
  writeTerminal,
} from '@/services/terminal/tauri'
import { useTheme } from '@/hooks/useTheme'
import type {
  TerminalEvent,
  TerminalId,
  TerminalStatus,
} from '@/types/terminal'

const DEFAULT_STATUS: TerminalStatus = {
  phase: 'idle',
  generation: 0,
  replayComplete: true,
}

const DARK_TERMINAL_THEME: ITheme = {
  background: '#08090b',
  foreground: '#f3f5f7',
  cursor: '#3dd3c8',
  cursorAccent: '#08090b',
  selectionBackground: '#3dd3c84d',
  black: '#08090b',
  red: '#f2777a',
  green: '#76c7a0',
  yellow: '#f2ec5d',
  blue: '#68aee8',
  magenta: '#b69cff',
  cyan: '#3dd3c8',
  white: '#c6cacf',
  brightBlack: '#5a6068',
  brightWhite: '#f3f5f7',
}

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#fafbfc',
  foreground: '#0a0c0f',
  cursor: '#0b6b6b',
  cursorAccent: '#fafbfc',
  selectionBackground: '#0b6b6b33',
  black: '#0a0c0f',
  red: '#b4232c',
  green: '#147a55',
  yellow: '#716d00',
  blue: '#1769aa',
  magenta: '#7147a8',
  cyan: '#0b6b6b',
  white: '#e3e5e8',
  brightBlack: '#5a6068',
  brightWhite: '#ffffff',
}

function terminalCellPixels(
  container: HTMLDivElement | null,
  rows: number,
  cols: number
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor((container?.clientWidth ?? 0) / cols)),
    height: Math.max(1, Math.floor((container?.clientHeight ?? 0) / rows)),
  }
}

type EmbeddedTerminal = {
  containerRef: RefObject<HTMLDivElement | null>
  terminalRef: RefObject<Terminal | null>
  generationRef: RefObject<number>
  statusRef: RefObject<TerminalStatus>
  attached: boolean
  status: TerminalStatus
  updateStatus: (status: TerminalStatus) => void
  error?: string
  setError: Dispatch<SetStateAction<string | undefined>>
  replayUnavailable: boolean
  setReplayUnavailable: Dispatch<SetStateAction<boolean>>
}

export function useEmbeddedTerminal({
  terminalId,
  visible,
  available,
}: {
  terminalId: TerminalId
  visible: boolean
  available: boolean
}): EmbeddedTerminal {
  const isDark = useTheme((state) => state.isDark)
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const generationRef = useRef(0)
  const sequenceRef = useRef(0)
  const statusRef = useRef<TerminalStatus>(DEFAULT_STATUS)
  const [attached, setAttached] = useState(false)
  const [status, setStatus] = useState<TerminalStatus>(DEFAULT_STATUS)
  const [error, setError] = useState<string>()
  const [replayUnavailable, setReplayUnavailable] = useState(false)

  const updateStatus = useCallback((next: TerminalStatus) => {
    statusRef.current = next
    generationRef.current = next.generation
    setStatus(next)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily:
        "'Geist Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: useTheme.getState().isDark
        ? DARK_TERMINAL_THEME
        : LIGHT_TERMINAL_THEME,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const flow = new TerminalFlowController((paused) => {
      const generation = generationRef.current
      if (generation === 0) return
      void setTerminalFlow(terminalId, generation, paused).catch(
        () => undefined
      )
    })
    const handleEvent = (event: TerminalEvent) => {
      if (
        generationRef.current !== 0 &&
        event.generation < generationRef.current
      ) {
        return
      }
      if (event.generation !== generationRef.current) {
        generationRef.current = event.generation
        sequenceRef.current = 0
        flow.reset()
      }
      if (event.sequence <= sequenceRef.current) return
      sequenceRef.current = event.sequence

      switch (event.type) {
        case 'started':
          terminal.reset()
          setReplayUnavailable(false)
          updateStatus({
            phase: 'running',
            generation: event.generation,
            cwd: event.cwd,
            launch: event.launch,
            replayComplete: true,
          })
          break
        case 'output': {
          const bytes = base64ToBytes(event.data)
          const drained = flow.enqueue(bytes.byteLength)
          terminal.write(bytes, drained)
          break
        }
        case 'exited':
          flow.reset()
          updateStatus({
            ...statusRef.current,
            phase: 'exited',
            generation: event.generation,
            exitCode: event.exit_code,
            signal: event.signal,
          })
          break
        case 'replay_unavailable':
          terminal.reset()
          setReplayUnavailable(true)
          break
        case 'error':
          setError(event.message)
          break
      }
    }

    let cancelled = false
    if (available) {
      void attachTerminal(terminalId, handleEvent)
        .then((next) => {
          if (cancelled) return
          if (next.generation >= generationRef.current) updateStatus(next)
          setAttached(true)
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason))
        })
    }

    const encoder = new TextEncoder()
    const dataDisposable = terminal.onData((data) => {
      const generation = generationRef.current
      if (generation === 0) return
      void writeTerminal(terminalId, generation, encoder.encode(data)).catch(
        (reason) => setError(String(reason))
      )
    })
    const binaryDisposable = terminal.onBinary((data) => {
      const generation = generationRef.current
      if (generation === 0) return
      void writeTerminal(
        terminalId,
        generation,
        terminalBinaryStringToBytes(data)
      ).catch((reason) => setError(String(reason)))
    })
    const resizeDisposable = terminal.onResize(({ rows, cols }) => {
      const generation = generationRef.current
      if (generation === 0) return
      const pixels = terminalCellPixels(container, rows, cols)
      void resizeTerminal(
        terminalId,
        generation,
        Math.max(2, rows),
        Math.max(2, cols),
        pixels.width,
        pixels.height
      ).catch(() => undefined)
    })

    let resizeFrame = 0
    const fit = () => {
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        const dimensions = fitAddon.proposeDimensions()
        if (!dimensions) return
        terminal.resize(
          Math.max(2, dimensions.cols),
          Math.max(2, dimensions.rows)
        )
      })
    }
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    observer?.observe(container)
    fit()

    return () => {
      cancelled = true
      observer?.disconnect()
      window.cancelAnimationFrame(resizeFrame)
      dataDisposable.dispose()
      binaryDisposable.dispose()
      resizeDisposable.dispose()
      flow.reset()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [available, terminalId, updateStatus])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = isDark
      ? DARK_TERMINAL_THEME
      : LIGHT_TERMINAL_THEME
  }, [isDark])

  useEffect(() => {
    if (!visible) return
    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current
      const dimensions = fitAddonRef.current?.proposeDimensions()
      if (terminal && dimensions) {
        terminal.resize(
          Math.max(2, dimensions.cols),
          Math.max(2, dimensions.rows)
        )
      }
      terminal?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  return {
    containerRef,
    terminalRef,
    generationRef,
    statusRef,
    attached,
    status,
    updateStatus,
    error,
    setError,
    replayUnavailable,
    setReplayUnavailable,
  }
}
