import type { ComponentType, ReactNode } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { BaseExtension } from '../../../../../core/src/browser/extension'
import attachmentSchema from '../../../../../extensions/rag-extension/settings.json'
import type { SettingComponentProps } from '@gchat/core'
import settingsTranslations from '@/locales/en/settings.json'
import { useAttachments } from '@/hooks/useAttachments'
import { Route } from '../attachments'

const { getExtension } = vi.hoisted(() => ({
  // The hook also hydrates at import time, before a test supplies its extension.
  getExtension: vi.fn().mockReturnValue({
    getSettings: vi.fn().mockResolvedValue([]),
  }),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: getExtension }) },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: ComponentType }) => options,
}))

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <nav>Settings</nav>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/containers/Card', () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  CardItem: ({ title, actions }: { title: string; actions: ReactNode }) => (
    <div role="group" aria-label={title}>
      <span>{title}</span>
      {actions}
    </div>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const attachmentKey = key.replace('settings:attachments.', '')
      return (
        settingsTranslations.attachments[
          attachmentKey as keyof typeof settingsTranslations.attachments
        ] ?? key
      )
    },
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (selector: (state: unknown) => unknown) =>
    selector({ maxImageSizePx: 0, setMaxImageSizePx: vi.fn() }),
}))

class AttachmentExtension extends BaseExtension {
  onLoad() {
    return
  }

  onUnload() {
    return
  }
}

const STORAGE_KEY = 'attachment-settings-durability-test'
const text = settingsTranslations.attachments
const Page = Route.component as ComponentType
let extension: AttachmentExtension
let updateSettings: MockInstance<AttachmentExtension['updateSettings']>
let unblockReads: (() => void)[]

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Hold the real extension's read after it captured the old schema. Without
// serialization, another update can commit and then be overwritten by that read.
function blockNextSettingsRead() {
  const gate = deferred()
  const started = deferred()
  const readSettings = extension.getSettings.bind(extension)
  const reads = vi.spyOn(extension, 'getSettings')
  reads.mockImplementationOnce(async () => {
    const snapshot = await readSettings()
    started.resolve()
    await gate.promise
    return snapshot
  })
  unblockReads.push(gate.resolve)
  return { reads, started: started.promise, release: gate.resolve }
}

function storedValues() {
  const settings = JSON.parse(
    localStorage.getItem(STORAGE_KEY) ?? '[]'
  ) as SettingComponentProps[]
  return Object.fromEntries(
    settings.map((setting) => [setting.key, setting.controllerProps.value])
  )
}

function input(title: string) {
  const key = title.replace('settings:attachments.', '')
  const name = text[key as keyof typeof text] ?? title
  return screen.getByRole('textbox', { name })
}

async function drainSettingsQueue() {
  await act(async () => {
    await useAttachments.getState().loadSettingsDefs()
  })
}

async function openSettings() {
  const page = render(<Page />)
  await drainSettingsQueue()
  return page
}

beforeEach(async () => {
  vi.useFakeTimers()
  unblockReads = []
  extension = new AttachmentExtension('', STORAGE_KEY)
  getExtension.mockReturnValue(extension)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(attachmentSchema))
  useAttachments.setState(useAttachments.getInitialState())
  await drainSettingsQueue()
  updateSettings = vi.spyOn(extension, 'updateSettings')
})

afterEach(async () => {
  // Also release a held read if an assertion failed, so the next test cannot
  // inherit a pending store operation.
  unblockReads.forEach((release) => release())
  cleanup()
  await drainSettingsQueue()
  localStorage.removeItem(STORAGE_KEY)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Attachment settings persistence', () => {
  it('names fields with their visible translated titles and persists a named edit', async () => {
    const page = await openSettings()
    const maxFileSize = screen.getByRole('textbox', { name: text.maxFile })
    const autoInlineRatio = screen.getByRole('textbox', {
      name: text.autoInlineThreshold,
    })

    expect(screen.getByText(text.maxFile)).toBeVisible()
    expect(screen.getByText(text.autoInlineThreshold)).toBeVisible()
    expect(maxFileSize).toHaveValue('20')
    expect(autoInlineRatio).toHaveValue('0.75')

    fireEvent.change(maxFileSize, { target: { value: '21' } })
    page.unmount()
    await drainSettingsQueue()
    await openSettings()

    expect(screen.getByRole('textbox', { name: text.maxFile })).toHaveValue('21')
    expect(storedValues().max_file_size_mb).toBe(21)
    expect(updateSettings).toHaveBeenCalledTimes(1)
  })

  it('keeps the 500 ms typing debounce and saves the latest value once', async () => {
    const page = await openSettings()
    const maxFileSize = input('settings:attachments.maxFile')

    fireEvent.change(maxFileSize, { target: { value: '21' } })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.change(maxFileSize, { target: { value: '22' } })
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(updateSettings).not.toHaveBeenCalled()
    expect(maxFileSize).toHaveValue('22')

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await drainSettingsQueue()
    expect(storedValues().max_file_size_mb).toBe(22)
    expect(updateSettings).toHaveBeenCalledTimes(1)

    page.unmount()
    await drainSettingsQueue()
    expect(updateSettings).toHaveBeenCalledTimes(1)
  })

  it('flushes two edits together on quick navigation and hydrates after a delayed save', async () => {
    const page = await openSettings()
    const held = blockNextSettingsRead()

    fireEvent.change(input('settings:attachments.maxFile'), {
      target: { value: '21' },
    })
    fireEvent.change(input('settings:attachments.topK'), {
      target: { value: '5' },
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    page.unmount()
    render(<Page />)

    await act(async () => held.started)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        { key: 'max_file_size_mb', controllerProps: { value: 21 } },
        { key: 'retrieval_limit', controllerProps: { value: 5 } },
      ])
    )
    expect(updateSettings.mock.calls[0][0]).toHaveLength(2)
    // Remount hydration must wait instead of reading the old persisted schema.
    expect(held.reads).toHaveBeenCalledTimes(1)
    expect(storedValues().max_file_size_mb).toBe(20)

    held.release()
    await drainSettingsQueue()
    expect(storedValues()).toMatchObject({
      max_file_size_mb: 21,
      retrieval_limit: 5,
    })
    expect(input('settings:attachments.maxFile')).toHaveValue('21')
    expect(input('settings:attachments.topK')).toHaveValue('5')

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await drainSettingsQueue()
    expect(updateSettings).toHaveBeenCalledTimes(1)
  })

  it('serializes an in-flight debounce, an immediate switch and a later navigation flush', async () => {
    const page = await openSettings()
    const held = blockNextSettingsRead()
    fireEvent.change(input('settings:attachments.maxFile'), {
      target: { value: '21' },
    })
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    await act(async () => held.started)

    fireEvent.change(input('settings:attachments.maxFile'), {
      target: { value: '22' },
    })
    fireEvent.click(
      within(
        screen.getByRole('group', { name: text.enable })
      ).getByRole('switch')
    )
    page.unmount()
    render(<Page />)
    expect(updateSettings).toHaveBeenCalledTimes(1)

    held.release()
    await drainSettingsQueue()
    expect(updateSettings).toHaveBeenCalledTimes(3)
    expect(storedValues()).toMatchObject({
      enabled: false,
      max_file_size_mb: 22,
    })
    expect(useAttachments.getState()).toMatchObject({
      enabled: false,
      maxFileSizeMB: 22,
    })
    expect(input('settings:attachments.maxFile')).toHaveValue('22')
    expect(
      within(
        screen.getByRole('group', { name: text.enable })
      ).getByRole('switch')
    ).not.toBeChecked()
  })

  it('applies the existing bounds and integer rules when navigation flushes a batch', async () => {
    const page = await openSettings()
    const changes = [
      ['settings:attachments.maxFile', '500'],
      ['settings:attachments.topK', '6.9'],
      ['settings:attachments.threshold', '-0.2'],
      ['settings:attachments.autoInlineThreshold', '0.83'],
      ['settings:attachments.chunkSize', '-4'],
      ['settings:attachments.chunkOverlap', '9000'],
    ]
    changes.forEach(([title, value]) => {
      fireEvent.change(input(title), { target: { value } })
    })

    page.unmount()
    await drainSettingsQueue()
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(storedValues()).toMatchObject({
      max_file_size_mb: 200,
      retrieval_limit: 6,
      retrieval_threshold: 0,
      auto_inline_context_ratio: 0.83,
      chunk_size_chars: 64,
      overlap_chars: 1024,
    })
  })

  it('keeps the saved value when a numeric edit is not finite', async () => {
    const page = await openSettings()
    fireEvent.change(input('settings:attachments.maxFile'), {
      target: { value: 'not-a-number' },
    })
    page.unmount()
    await drainSettingsQueue()
    expect(storedValues().max_file_size_mb).toBe(20)
  })

  it('rejects a failed write without publishing it and allows the next setter to save', async () => {
    const failure = new Error('settings write failed')
    updateSettings.mockRejectedValueOnce(failure)

    await expect(
      useAttachments.getState().setMaxFileSizeMB(21)
    ).rejects.toBe(failure)
    expect(useAttachments.getState().maxFileSizeMB).toBe(20)

    await useAttachments.getState().setRetrievalLimit(5)
    await drainSettingsQueue()
    expect(storedValues()).toMatchObject({
      max_file_size_mb: 20,
      retrieval_limit: 5,
    })
    expect(useAttachments.getState().retrievalLimit).toBe(5)
  })
})
