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
    profile: { id: 'fixture-c4', name: 'Fixture C4', tp: 1, max_context: 32768, concurrency: 4,
      options: { vision: false }, qualification: { tier: 'full-context-tested' } } }],
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

it('distinguishes calculated smoke evidence from full-context testing', () => {
  const data = snapshot()
  data.instances = []
  data.launch_profiles![0].profile.qualification.tier = 'calculated-startup-smoke'
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  const option = screen.getByRole('option', { name: /Calculated \+ startup\/smoke checked/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  expect(screen.getByText(/Full-length requests have not been tested/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start profile' })).toBeEnabled()
})

it('defaults new instances to an available Vision profile without starting it', () => {
  const data = snapshot()
  data.instances = []
  const vision = structuredClone(data.launch_profiles![0])
  vision.profile.id = 'vision'
  vision.profile.options.vision = true
  data.launch_profiles!.push(vision)
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  const selected = screen.getByRole('option', { name: /Vision \+ text \(default\)/ }) as HTMLOptionElement
  expect(screen.getByLabelText('Hardware profile')).toHaveValue(selected.value)
  expect(launch).not.toHaveBeenCalled()
  const text = screen.getByRole('option', { name: /Text only/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: text.value } })
  expect(screen.getByLabelText('Hardware profile')).toHaveValue(text.value)
})

it('keeps pending Vision profiles selectable and warns about unverified startup', () => {
  const data = snapshot()
  data.instances = []
  data.launch_profiles![0].profile.options.vision = true
  data.launch_profiles![0].profile.qualification.tier = 'calculated-pending-validation'
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  expect(screen.getByText(/Startup, memory margin and inference are unverified/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start profile' })).toBeEnabled()
})
