import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineProfilePicker } from '../EngineProfilePicker'
import type { EngineSnapshot } from '@/services/engines'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const snapshot = (): EngineSnapshot => ({
  host_id: 'host', display_name: 'Host', revision: 1,
  gpus: [{ uuid: 'GPU-one', name: 'Fixture GPU', memory_mib: 32607, compute_capability: '12.0' }],
  models: [], instances: [{ instance_id: 'existing', session_id: 'session', display_name: 'Muse',
    upstream_model_id: 'muse', status: 'ready', configuration: { gpu_uuids: ['GPU-one'], max_context: 8192, concurrency: 1 } }],
  launch_profiles: [{ model_id: 'model', gpu_groups: [], compatible_gpu_groups: [['GPU-one']],
    profile: { id: 'fixture-c4', name: 'Fixture C4', tp: 1, max_context: 32768, concurrency: 4 } }],
})

it('reserves other instances GPUs and requires confirmation before switching their profile', async () => {
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={snapshot()} disabled={false} launch={launch} />)
  expect(screen.getByLabelText('Hardware profile')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start profile' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Serving instance'), { target: { value: 'existing' } })
  expect(screen.getByLabelText('Hardware profile')).toBeEnabled()
  const option = screen.getByRole('option', { name: /Fixture C4/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  expect(launch).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith({ profile_id: 'fixture-c4', model_id: 'model',
    gpu_uuids: ['GPU-one'], instance_id: 'existing', force: false, expected_session_id: 'session' }))
  expect(screen.getByLabelText('Serving instance')).toHaveValue('existing')
})

it('keeps offline snapshots read-only and does not invent missing profiles', () => {
  const data = snapshot()
  data.launch_profiles = []
  render(<EngineProfilePicker snapshot={data} disabled launch={vi.fn()} />)
  expect(screen.getByText(/No qualified profiles/)).toBeInTheDocument()
  expect(screen.getByLabelText('Serving instance')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start profile' })).toBeDisabled()
})
