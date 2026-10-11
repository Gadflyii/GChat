import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { BenchmarkLeaderboard } from '../BenchmarkLeaderboard'
import { localStorageKey } from '@/constants/localStorage'
import { useBenchmarkStore } from '@/stores/benchmark-store'
import type { BenchmarkResult } from '@/services/benchmark/tauri'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const id = 'published-run-001'
const receipt = { run_id: id, delete_token: 'b'.repeat(64), owner_token: 'c'.repeat(64) }
const other = { run_id: 'other-published-run', delete_token: 'd'.repeat(64) }

beforeEach(() => {
  vi.mocked(invoke).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.success).mockReset()
  localStorage.setItem(localStorageKey.gbenchReceipts, JSON.stringify({ [id]: receipt, [other.run_id]: other }))
  useBenchmarkStore.setState({ runs: [], selectedRunId: null })
})
afterEach(() => { cleanup(); localStorage.removeItem(localStorageKey.gbenchReceipts) })

it('restores published results without local history and requires explicit confirmation', async () => {
  const view = render(<BenchmarkLeaderboard />)
  fireEvent.click((await screen.findAllByRole('button', { name: 'Remove from leaderboard' }))[0])
  expect(screen.getByRole('dialog')).toHaveTextContent('Your local benchmark history and other published results are kept.')
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(invoke).not.toHaveBeenCalled()
  view.unmount()
  render(<BenchmarkLeaderboard />)
  expect(await screen.findByRole('link', { name: `View result ${id}` })).toHaveAttribute('href', `https://sectilelabs.ai/gbench/?run=${id}`)
})

it('clears only the confirmed publication and preserves local benchmark history', async () => {
  const local: BenchmarkResult = { benchmark_id: 'custom', hardware: null, methodology: 'ginfer-resident-max-perf-v1', run_id: id, started_at_ms: 1, completed_at_ms: 1001, points: [],
    session: { display_name: 'Saved local run', pid: null, target_id: 'ginfer/local/instance', session_id: 'session', model_id: 'model', model_path: '/model.ginfer', max_context: 8192, max_concurrency: 1, vision: true, spec: 'auto', draft_tokens: 0, draft_tp: 0, kv_dtype: 'int8', prefill_chunk: 0, cuda_graph: true },
  }
  useBenchmarkStore.setState({ runs: [local], selectedRunId: id })
  vi.mocked(invoke).mockResolvedValueOnce(undefined)
  render(<BenchmarkLeaderboard />)
  fireEvent.click((await screen.findAllByRole('button', { name: 'Remove from leaderboard' }))[0])
  fireEvent.click(screen.getByRole('button', { name: 'Remove published result' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: `View result ${id}` })).not.toBeInTheDocument())
  expect(invoke).toHaveBeenCalledWith('delete_benchmark', { runId: id, deleteToken: receipt.delete_token })
  expect(screen.getByRole('link', { name: `View result ${other.run_id}` })).toBeInTheDocument()
  expect(useBenchmarkStore.getState().runs).toEqual([local])
  expect(useBenchmarkStore.getState().selectedRunId).toBe(id)
  cleanup()
  render(<BenchmarkLeaderboard />)
  expect(screen.queryByRole('link', { name: `View result ${id}` })).not.toBeInTheDocument()
  expect(await screen.findByRole('link', { name: `View result ${other.run_id}` })).toBeInTheDocument()
})

it('retains ownership and the confirmation for retry after a deletion error', async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Invalid deletion receipt.'))
  render(<BenchmarkLeaderboard />)
  fireEvent.click((await screen.findAllByRole('button', { name: 'Remove from leaderboard' }))[0])
  fireEvent.click(screen.getByRole('button', { name: 'Remove published result' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not finish leaderboard removal', { description: 'Invalid deletion receipt.' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove published result' })).toBeEnabled()
  expect(JSON.parse(localStorage.getItem(localStorageKey.gbenchReceipts)!)[id]).toEqual(receipt)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('link', { name: `View result ${id}` })).toBeInTheDocument()
})

it('reports unreadable receipts without crashing or offering an unowned deletion', async () => {
  localStorage.setItem(localStorageKey.gbenchReceipts, 'null')
  render(<BenchmarkLeaderboard />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read saved leaderboard ownership receipts')
  expect(screen.queryByRole('button', { name: 'Remove from leaderboard' })).not.toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalled()
})
