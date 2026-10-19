import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type VoiceStatus = {
  model_ready: boolean
  download_bytes: number
  can_speak: boolean
  listening: boolean
}

export const NO_SPEECH_SERVICE = 'Install a speech service to hear replies.'

export const voiceStatus = () => invoke<VoiceStatus>('voice_status')
export const voicePrepare = () => invoke<void>('voice_prepare')
export const voiceListenStart = () => invoke<void>('voice_listen_start')
export const voiceListenStop = () => invoke<string>('voice_listen_stop')
export const voiceListenCancel = () => invoke<void>('voice_listen_cancel')
export const voiceSpeak = (text: string) => invoke<void>('voice_speak', { text })
export const voiceSpeakStop = () => invoke<void>('voice_speak_stop')

export const onVoiceDownload = (
  handler: (progress: { done: number; total: number }) => void
) => listen<{ done: number; total: number }>('voice-download', (e) => handler(e.payload))
