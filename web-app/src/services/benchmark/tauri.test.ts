import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelBenchmark,
  listBenchmarkSessions,
  runBenchmark,
} from './tauri'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.listen.mockReset()
})

describe('GInfer benchmark IPC', () => {
  it('lists the sessions owned by the loaded GInfer plugin', async () => {
    mocks.invoke.mockResolvedValueOnce([{ pid: 42, model_id: 'qwen' }]).mockResolvedValueOnce([])

    await expect(listBenchmarkSessions()).resolves.toEqual([
      { pid: 42, model_id: 'qwen', target_id: 'local:42' },
    ])
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:ginfer|get_all_sessions')
  })

  it('passes the complete workload to the resident-server runner', async () => {
    const request = {
      run_id: 'run-1',
      session_pid: 42,
      prompt_tokens: 2048,
      max_output_tokens: 512,
      concurrencies: [1, 2, 4],
      warmup_rounds: 1,
      measured_rounds: 2,
    }
    const result = {
      run_id: request.run_id,
      started_at_ms: 1,
      completed_at_ms: 2,
      session: { model_id: 'qwen' },
      points: [{ concurrency: 1 }],
    }
    mocks.invoke.mockResolvedValue(result)

    await expect(runBenchmark(request)).resolves.toEqual(result)

    expect(mocks.invoke).toHaveBeenCalledWith(
      'plugin:ginfer|run_ginfer_benchmark',
      { request }
    )
  })

  it('cancels by run id without touching the loaded model', async () => {
    mocks.invoke.mockResolvedValue(true)

    await expect(cancelBenchmark('run-1')).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith(
      'plugin:ginfer|cancel_ginfer_benchmark',
      { runId: 'run-1' }
    )
  })

  it('keeps equal model names on different hosts as distinct targets', async () => {
    mocks.invoke.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { pid: null, target_id: 'ginfer/host-a/instance', model_id: 'muse' },
      { pid: null, target_id: 'ginfer/host-b/instance', model_id: 'muse' },
    ])
    const sessions = await listBenchmarkSessions()
    expect(sessions.map((s) => s.target_id)).toEqual(['ginfer/host-a/instance', 'ginfer/host-b/instance'])
    const request = { run_id: 'remote-run', session_pid: null, prompt_tokens: 512, max_output_tokens: 128, concurrencies: [1], warmup_rounds: 0, measured_rounds: 1 }
    mocks.invoke.mockResolvedValue({ run_id: 'remote-run' })
    await runBenchmark(request, sessions[1].target_id)
    expect(mocks.invoke).toHaveBeenLastCalledWith('engine_hosts_command', {
      action: 'benchmark', args: { target_id: 'ginfer/host-b/instance', request },
    })
  })
})
