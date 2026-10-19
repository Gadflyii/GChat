import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ReadAloud, VoiceInput } from './GbotVoice'

const voice = vi.hoisted(() => ({
  voiceStatus: vi.fn(),
  voicePrepare: vi.fn(),
  voiceListenStart: vi.fn(),
  voiceListenStop: vi.fn(),
  voiceListenCancel: vi.fn(),
  voiceSpeak: vi.fn(),
  voiceSpeakStop: vi.fn(),
  onVoiceDownload: vi.fn(),
}))
vi.mock('@/services/voice', async () => ({
  ...(await vi.importActual<object>('@/services/voice')),
  ...voice,
}))

const status = (over = {}) => ({
  model_ready: true,
  download_bytes: 147_964_211,
  can_speak: true,
  listening: false,
  ...over,
})

beforeEach(() => {
  Object.values(voice).forEach((mock) => mock.mockReset())
  voice.voiceStatus.mockResolvedValue(status())
  voice.voiceListenCancel.mockResolvedValue(undefined)
  voice.onVoiceDownload.mockResolvedValue(vi.fn())
})
afterEach(cleanup)

it('records, then hands the transcript over for review', async () => {
  voice.voiceListenStart.mockResolvedValue(undefined)
  voice.voiceListenStop.mockResolvedValue('book a table for two')
  const onText = vi.fn()
  render(<VoiceInput onText={onText} />)
  await waitFor(() => expect(voice.voiceStatus).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Speak a task' }))
  expect(await screen.findByRole('status')).toHaveTextContent('check before you choose Run')
  fireEvent.click(screen.getByRole('button', { name: 'Stop and use what I said' }))
  await waitFor(() => expect(onText).toHaveBeenCalledWith('book a table for two'))
})

it('asks before the one-time model download, shows progress and then allows speaking', async () => {
  voice.voiceStatus.mockResolvedValue(status({ model_ready: false }))
  let report: (p: { done: number; total: number }) => void = () => undefined
  voice.onVoiceDownload.mockImplementation(async (handler) => {
    report = handler
    return vi.fn()
  })
  let finish: () => void = () => undefined
  voice.voicePrepare.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
  render(<VoiceInput onText={vi.fn()} />)
  await waitFor(() => expect(voice.voiceStatus).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Speak a task' }))
  expect(screen.getByText(/one-time download of about 148 MB/)).toBeVisible()
  expect(screen.getByText(/Nothing you say leaves this computer/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Download speech model' }))
  await waitFor(() => expect(voice.onVoiceDownload).toHaveBeenCalled())
  report({ done: 74_000_000, total: 148_000_000 })
  expect(await screen.findByText(/Downloading the speech model… 50%/)).toBeVisible()
  finish()
  await waitFor(() => expect(screen.queryByText(/Downloading/)).toBeNull())
})

it('says plainly when the microphone or recognition fails', async () => {
  voice.voiceListenStart.mockRejectedValue('No microphone was found. Connect one and try again.')
  render(<VoiceInput onText={vi.fn()} />)
  await waitFor(() => expect(voice.voiceStatus).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Speak a task' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No microphone was found')
})

it('reads a reply aloud, can stop, and keeps the text when no speech service exists', async () => {
  voice.voiceSpeak.mockResolvedValueOnce(undefined)
  voice.voiceSpeakStop.mockResolvedValue(undefined)
  const { rerender } = render(<ReadAloud text="All done." />)
  fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
  await waitFor(() => expect(voice.voiceSpeak).toHaveBeenCalledWith('All done.'))
  fireEvent.click(await screen.findByRole('button', { name: 'Stop reading' }))
  await waitFor(() => expect(voice.voiceSpeakStop).toHaveBeenCalled())
  rerender(<ReadAloud text="Second reply" />)
  voice.voiceSpeak.mockRejectedValueOnce('Install a speech service to hear replies.')
  fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Install a speech service to hear replies. The reply stays here as text.'
  )
})

it('offers nothing to read for an empty reply', () => {
  render(<ReadAloud text="  " />)
  expect(screen.queryByRole('button')).toBeNull()
})
