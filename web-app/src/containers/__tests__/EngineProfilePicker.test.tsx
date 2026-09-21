import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineProfilePicker } from '../EngineProfilePicker'
import type { EngineSnapshot } from '@/services/engines'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const snapshot = (): EngineSnapshot => ({
  host_id: 'host', display_name: 'Host', revision: 1,
  gpus: [{ uuid: 'GPU-one', name: 'Fixture GPU', memory_mib: 32607, compute_capability: '12.0' }],
  models: [{ id: 'model', path: '/model.ginfer', artifact_set: false, metadata: { identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4' }, tp_size: 1, draft_tp: 0, size_bytes: 1024 } }], instances: [{ instance_id: 'existing', session_id: 'session', display_name: 'Muse',
    upstream_model_id: 'muse', status: 'ready', configuration: { gpu_uuids: ['GPU-one'], max_context: 8192, concurrency: 1 } }],
  launch_profiles: [{ model_id: 'model', gpu_groups: [], compatible_gpu_groups: [['GPU-one']],
    profile: { id: 'fixture-c4', name: 'Fixture C4', tp: 1, max_context: 32768, concurrency: 4,
      options: { vision: false }, qualification: { tier: 'full-context-tested' } } }],
})

it('reserves other instances GPUs and requires confirmation before switching their profile', async () => {
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={snapshot()} disabled={false} launch={launch} />)
  expect(screen.getByLabelText('Hardware profile')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Server Host'), { target: { value: 'existing' } })
  expect(screen.getByLabelText('Hardware profile')).toBeEnabled()
  expect(screen.getByLabelText('GPU / GPU group')).toBeDisabled()
  const option = screen.getByRole('option', { name: /Fixture C4/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  expect(launch).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith({ profile_id: 'fixture-c4', model_id: 'model',
    gpu_uuids: ['GPU-one'], instance_id: 'existing', force: false, expected_session_id: 'session' }))
  expect(screen.getByLabelText('Server Host')).toHaveValue('existing')
})

it('keeps offline snapshots read-only and does not invent missing profiles', () => {
  const data = snapshot()
  data.launch_profiles = []
  data.models = []
  render(<EngineProfilePicker snapshot={data} disabled launch={vi.fn()} />)
  expect(screen.getByText(/No installed models were found/)).toBeInTheDocument()
  expect(screen.getByLabelText('Server Host')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeDisabled()
})

it('distinguishes calculated smoke evidence from full-context testing', () => {
  const data = snapshot()
  data.instances = []
  data.launch_profiles![0].profile.qualification.tier = 'calculated-startup-smoke'
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  const option = screen.getByRole('option', { name: /Calculated \+ startup\/smoke checked/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  expect(screen.getByText(/Full-length requests have not been tested/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeEnabled()
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
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeEnabled()
})

it('filters profiles by model and assigned hardware and clears a previous model choice', () => {
  const data = snapshot()
  data.models.push({ ...data.models[0], id: 'qwen', metadata: { ...data.models[0].metadata,
    identity: { model_id: 'qwen3.8-27b', weights_id: 'nvfp4' } } })
  data.gpus.push({ ...data.gpus[0], uuid: 'GPU-two' })
  const qwen = structuredClone(data.launch_profiles![0])
  qwen.model_id = 'qwen'
  qwen.profile.id = 'qwen-c4'
  qwen.profile.name = 'Qwen C4'
  const otherGpu = structuredClone(qwen)
  otherGpu.profile.id = 'other-gpu'
  otherGpu.profile.name = 'Other GPU profile'
  otherGpu.compatible_gpu_groups = [['GPU-two']]
  const unsupported = structuredClone(qwen)
  unsupported.profile.name = 'Unsupported hardware'
  unsupported.compatible_gpu_groups = []
  data.launch_profiles!.push(qwen, otherGpu, unsupported)
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} instanceId="existing" disabled={false} launch={launch} />)
  const profile = screen.getByLabelText('Hardware profile')
  const initial = screen.getByRole('option', { name: /Fixture C4/ }) as HTMLOptionElement
  fireEvent.change(profile, { target: { value: initial.value } })
  expect(screen.queryByRole('option', { name: /Qwen C4/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'qwen' } })
  expect(profile).toHaveValue('')
  expect(screen.queryByRole('option', { name: /Fixture C4/ })).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: /Qwen C4/ })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Other GPU profile|Unsupported hardware/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Apply profile and restart' })).toBeDisabled()
  expect(launch).not.toHaveBeenCalled()
})

it('selects physical GPUs separately and filters profiles before launching', async () => {
  const data = snapshot()
  data.instances = []
  data.gpus.push({ uuid: 'GPU-two', name: 'Other GPU', memory_mib: 24576 })
  const second = structuredClone(data.launch_profiles![0])
  second.profile.id = 'second'
  second.profile.name = 'Second GPU profile'
  second.compatible_gpu_groups = [['GPU-two']]
  data.launch_profiles!.push(second)
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={data} instanceId="" disabled={false} launch={launch} />)
  const gpu = screen.getByLabelText('GPU / GPU group')
  expect(gpu).toHaveValue(JSON.stringify(['GPU-one']))
  expect(screen.queryByRole('option', { name: /Second GPU profile/ })).not.toBeInTheDocument()
  const first = screen.getByRole('option', { name: /Fixture C4/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: first.value } })
  fireEvent.change(gpu, { target: { value: JSON.stringify(['GPU-two']) } })
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeDisabled()
  expect(screen.queryByRole('option', { name: /Fixture C4/ })).not.toBeInTheDocument()
  const option = screen.getByRole('option', { name: /Second GPU profile/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  fireEvent.click(screen.getByRole('button', { name: 'Start Server Instance' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ gpu_uuids: ['GPU-two'], profile_id: 'second' })))
})

it('offers declared TP groups and explains cards without a matching profile', () => {
  const data = snapshot()
  data.instances = []
  data.gpus.push({ ...data.gpus[0], uuid: 'GPU-two' }, { uuid: 'GPU-three', name: 'Different GPU', memory_mib: 24576 })
  data.launch_profiles![0].profile.tp = 2
  data.launch_profiles![0].compatible_gpu_groups = [['GPU-one', 'GPU-two']]
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  const gpu = screen.getByLabelText('GPU / GPU group')
  expect(gpu).toHaveValue(JSON.stringify(['GPU-one', 'GPU-two']))
  fireEvent.change(gpu, { target: { value: JSON.stringify(['GPU-three']) } })
  expect(screen.getByLabelText('Hardware profile')).toBeDisabled()
  expect(screen.getByText(/No profiles match this model on the selected GPU group/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeDisabled()
  expect(launch).not.toHaveBeenCalled()
})
