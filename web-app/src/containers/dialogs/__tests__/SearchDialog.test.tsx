import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { useThreads } from '@/hooks/useThreads'
import { SearchDialog } from '../SearchDialog'

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const threads: Thread[] = [
  { id: 'atlas', title: 'Atlas', updated: 1 },
  { id: 'shared', title: 'Arrival view', updated: 2 },
  { id: 'view', title: 'View', updated: 3 },
]
const scrollIntoView = vi.fn()
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  })
})

afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

beforeEach(() => {
  mocks.navigate.mockReset()
  scrollIntoView.mockClear()
  localStorage.removeItem(localStorageKey.recentSearches)
  useThreads.getState().setThreads(threads)
})

function SearchHistory() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open history search</button>
      <SearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

async function focusedSearchInput() {
  const input = screen.getByPlaceholderText('common:searchChats')
  await waitFor(() => expect(input).toHaveFocus())
  return input
}

describe('Chat history search keyboard selection', () => {
  it('selects the first match after replacing a query with the same result count', async () => {
    const user = userEvent.setup()
    render(<SearchHistory />)
    const input = await focusedSearchInput()

    await user.type(input, 'a')
    expect(
      useThreads.getState().getFilteredThreads('a').map(({ id }) => id)
    ).toEqual(['atlas', 'shared'])
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /Arrival view$/ })).toHaveClass(
      'bg-secondary/50'
    )

    // Replace in one edit: clearing first would change the count and mask the bug.
    await user.keyboard('{Control>}a{/Control}v')

    expect(input).toHaveValue('v')
    expect(
      useThreads.getState().getFilteredThreads('v').map(({ id }) => id)
    ).toEqual(['shared', 'view'])
    const firstResult = screen.getByRole('button', { name: /Arrival view$/ })
    expect(firstResult).toHaveClass('bg-secondary/50')
    expect(screen.getByRole('button', { name: /View$/ })).not.toHaveClass(
      'bg-secondary/50'
    )
    const scrollContexts = scrollIntoView.mock.contexts
    expect(scrollContexts[scrollContexts.length - 1]).toBe(firstResult)
    expect(input).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/threads/$threadId',
      params: { threadId: 'shared' },
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps arrow navigation working while the query is unchanged', async () => {
    const user = userEvent.setup()
    render(<SearchHistory />)
    const input = await focusedSearchInput()
    await user.type(input, 'a')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('button', { name: /Arrival view$/ })).toHaveClass(
      'bg-secondary/50'
    )
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('button', { name: /Atlas$/ })).toHaveClass(
      'bg-secondary/50'
    )
    expect(input).toHaveValue('a')
    expect(input).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/threads/$threadId',
      params: { threadId: 'atlas' },
    })
  })

  it('reopens a selected recent thread and clears recents without changing history', async () => {
    const user = userEvent.setup()
    const savedThreads = useThreads.getState().threads
    render(<SearchHistory />)
    const input = await focusedSearchInput()
    await user.type(input, 'v')
    await user.keyboard('{Enter}')

    await user.click(screen.getByRole('button', { name: 'Open history search' }))
    expect(await focusedSearchInput()).toHaveValue('')
    expect(screen.getByRole('button', { name: /Arrival view$/ })).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(mocks.navigate).toHaveBeenNthCalledWith(2, {
      to: '/threads/$threadId',
      params: { threadId: 'shared' },
    })
    expect(
      JSON.parse(localStorage.getItem(localStorageKey.recentSearches)!)
    ).toEqual(['shared'])

    await user.click(screen.getByRole('button', { name: 'Open history search' }))
    await focusedSearchInput()
    await user.click(screen.getByRole('button', { name: 'common:clearRecent' }))

    expect(
      screen.queryByRole('button', { name: /Arrival view$/ })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:newChat' })).toBeInTheDocument()
    expect(localStorage.getItem(localStorageKey.recentSearches)).toBeNull()
    expect(useThreads.getState().threads).toBe(savedThreads)
    expect(Object.keys(savedThreads)).toHaveLength(3)
  })
})
