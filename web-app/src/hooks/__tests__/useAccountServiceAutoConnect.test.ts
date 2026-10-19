import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useAccountServiceAutoConnect } from '../useAccountServiceAutoConnect'

const api = vi.hoisted(() => ({ target: vi.fn(), accounts: vi.fn() }))
vi.mock('@/services/gbot', () => ({ getGbotServiceTarget: api.target }))
vi.mock('@/services/workspace-connectors', () => ({ connectorAccounts: api.accounts }))

beforeEach(() => {
  vi.resetAllMocks()
  api.accounts.mockResolvedValue({})
})

it('connects this computer once when GChat opens', async () => {
  api.target.mockResolvedValue({ kind: 'local' })
  const { result } = renderHook(() => useAccountServiceAutoConnect())
  await waitFor(() => expect(api.accounts).toHaveBeenCalledExactlyOnceWith(true))
  expect(result.current).toBeUndefined()
})

it('leaves a service on another computer alone', async () => {
  api.target.mockResolvedValue({ kind: 'paired_host', host_id: 'h' })
  const { result } = renderHook(() => useAccountServiceAutoConnect())
  await waitFor(() => expect(api.target).toHaveBeenCalled())
  await Promise.resolve()
  expect(api.accounts).not.toHaveBeenCalled()
  expect(result.current).toBeUndefined()
})

it('stays silent when the service cannot connect yet', async () => {
  api.target.mockResolvedValue({ kind: 'local' })
  api.accounts.mockRejectedValue(new Error('secure storage is locked'))
  const { result, unmount } = renderHook(() => useAccountServiceAutoConnect())
  await waitFor(() => expect(api.accounts).toHaveBeenCalled())
  expect(result.current).toBeUndefined()
  expect(() => unmount()).not.toThrow()
})
