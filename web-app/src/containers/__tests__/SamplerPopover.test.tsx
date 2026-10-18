import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAssistant, useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import { resolveAssistantForThread } from '@/lib/samplingParams'
import { seedServiceHub } from '@/test/service-hub'
import type { ThreadsService } from '@/services/threads/types'
import { SamplerPopover } from '../SamplerPopover'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name: string }) => {
      if (key === 'assistants:useDefault') return `Use default (${values?.name})`
      if (key === 'assistants:none') return 'None'
      return key
    },
  }),
}))
vi.mock('fzf', () => ({
  Fzf: vi.fn(() => ({ find: vi.fn(() => []) })),
}))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
afterAll(() => vi.unstubAllGlobals())

const custom: Assistant = {
  ...defaultAssistant,
  avatar: undefined,
  id: 'custom',
  name: 'Research helper',
  instructions: 'Custom research instructions',
}
const fallback: Assistant = { ...defaultAssistant, avatar: undefined }
const updateThread = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  updateThread.mockClear()
  seedServiceHub({ threads: { updateThread } as unknown as ThreadsService })
  useAssistant.setState({
    assistants: [custom, fallback],
    defaultAssistantId: defaultAssistant.id,
    pendingAssistant: custom,
  })
  useThreads.setState({ threads: {}, currentThreadId: undefined })
})

async function openAssistantMenu() {
  const user = userEvent.setup()
  render(<SamplerPopover />)
  await user.click(screen.getByRole('button', { name: 'assistants:paramCategory.sampling' }))
  await user.click(screen.getByRole('button', { name: custom.name }))
  return user
}

describe('Sampling assistant fallback option', () => {
  it('names the default and restores it for a new chat', async () => {
    const user = await openAssistantMenu()

    expect(screen.queryByRole('menuitem', { name: /None/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /Use default \(GChat\)$/ }))

    expect(screen.getByRole('button', { name: 'GChat' })).toBeInTheDocument()
    expect(useAssistant.getState().pendingAssistant).toBeUndefined()
    expect(resolveAssistantForThread()).toBe(fallback)
    expect(updateThread).not.toHaveBeenCalled()
  })

  it('describes and persists clearing the override on an existing thread', async () => {
    const thread = {
      id: 'thread-1',
      title: 'Saved research',
      updated: 1,
      assistants: [custom],
      model: { id: 'model-1', provider: 'ginfer' },
    } as unknown as Thread
    useThreads.setState({ threads: { [thread.id]: thread }, currentThreadId: thread.id })
    const user = await openAssistantMenu()

    await user.click(screen.getByRole('menuitem', { name: /Use default \(GChat\)$/ }))

    expect(screen.getByRole('button', { name: 'GChat' })).toBeInTheDocument()
    expect(resolveAssistantForThread(thread.id)).toBe(fallback)
    expect(useThreads.getState().threads[thread.id].assistants).toEqual([])
    expect(updateThread).toHaveBeenCalledWith({ ...thread, assistants: [] })
  })

  it('names the first available assistant when the saved default is missing', async () => {
    useAssistant.setState({ defaultAssistantId: 'deleted' })
    const user = await openAssistantMenu()

    await user.click(screen.getByRole('menuitem', { name: /Use default \(Research helper\)$/ }))

    expect(screen.getByRole('button', { name: custom.name })).toBeInTheDocument()
    expect(resolveAssistantForThread()).toBe(custom)
  })

  it('keeps None accurate when there are no assistants', async () => {
    useAssistant.setState({ assistants: [], pendingAssistant: undefined })
    const user = userEvent.setup()
    render(<SamplerPopover />)
    await user.click(screen.getByRole('button', { name: 'assistants:paramCategory.sampling' }))
    await user.click(screen.getByRole('button', { name: /None$/ }))
    await user.click(screen.getByRole('menuitem', { name: /None$/ }))

    expect(screen.getByRole('button', { name: /None$/ })).toBeInTheDocument()
    expect(resolveAssistantForThread()).toBeUndefined()
  })

  it('preserves explicit named assistant selection', async () => {
    const user = await openAssistantMenu()
    await user.click(screen.getByRole('menuitem', { name: 'GChat' }))

    expect(useAssistant.getState().pendingAssistant).toBe(fallback)
    expect(resolveAssistantForThread()).toBe(fallback)
    expect(screen.getByRole('button', { name: 'GChat' })).toBeInTheDocument()
  })
})
