import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineProfilePicker } from '../EngineProfilePicker'
import type { EngineSnapshot } from '@/services/engines'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const visibleProfileIds = () => Array.from((screen.getByLabelText('Hardware profile') as HTMLSelectElement).options)
  .filter(option => option.value).map(option => JSON.parse(option.value)[1])
const snapshot = (): EngineSnapshot => ({
  host_id: 'host', display_name: 'Host', revision: 1,
  gpus: [{ uuid: 'GPU-one', name: 'Fixture GPU', memory_mib: 32607, compute_capability: '12.0' }],
  models: [{ id: 'model', path: '/model.ginfer', artifact_set: false, metadata: { identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4' }, tp_size: 1, draft_tp: 0, size_bytes: 1024 } }], instances: [{ instance_id: 'existing', session_id: 'session', display_name: 'Muse',
    upstream_model_id: 'muse', status: 'ready', configuration: { gpu_uuids: ['GPU-one'], max_context: 8192, concurrency: 1 } }],
  launch_profiles: [{ model_id: 'model', gpu_groups: [], compatible_gpu_groups: [['GPU-one']],
    profile: { id: 'fixture-c4', name: 'Fixture C4', tp: 1, max_context: 32768, concurrency: 4,
      options: { vision: false }, qualification: { tier: 'full-context-tested', engine_revision: '922e5a879b9af12e52763d52b73362937f9dd148' } } }],
})

it('reserves other instances GPUs and requires confirmation before switching their profile', async () => {
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={snapshot()} disabled={false} launch={launch} />)
  expect(screen.getByLabelText('Hardware profile')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Server Host'), { target: { value: 'existing' } })
  expect(screen.getByLabelText('Hardware profile')).toBeEnabled()
  expect(screen.getByLabelText('GPU / GPU group')).toBeDisabled()
  const option = screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  expect(launch).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith({ profile_id: 'fixture-c4', model_id: 'model',
    gpu_uuids: ['GPU-one'], instance_id: 'existing', force: false, structured_outputs: true, expected_session_id: 'session' }))
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

it('preserves saved structured-output OFF when applying a qualified profile', async () => {
  const data = snapshot()
  data.instances[0].profile = {
    model_id: 'model', gpu_uuids: ['GPU-one'], max_context: 8192, concurrency: 1,
    vision: false, structured_outputs: false, spec: 'none', draft_tokens: 0, draft_tp: 0,
    kv_dtype: 'auto', kv_arena_bytes: null, host_kv_cache_bytes: 0, prefill_chunk: 0, no_cuda_graph: false,
  }
  const launch = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<EngineProfilePicker snapshot={data} instanceId="existing" disabled={false} launch={launch} />)
  const structured = screen.getByRole('checkbox', { name: 'Structured outputs' })
  expect(structured).not.toBeChecked()
  const option = screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ structured_outputs: false })))
  fireEvent.click(structured)
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile and restart' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ structured_outputs: true })))
})

it('defaults a new profile launch to ON and distinguishes recorded structured-output OFF evidence', async () => {
  for (const enabled of [undefined, false]) {
    const data = snapshot()
    data.instances = []
    data.launch_profiles![0].profile.options.vision = true
    data.launch_profiles![0].profile.options.structured_outputs = enabled
    const launch = vi.fn().mockResolvedValue(undefined)
    const view = render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
    expect(screen.getByRole('checkbox', { name: 'Structured outputs' })).toBeChecked()
    expect(screen.getByText(/this launch custom and unqualified/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start Server Instance' }))
    await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ structured_outputs: true })))
    view.unmount()
  }
})

it('distinguishes calculated smoke evidence from full-context testing', () => {
  const data = snapshot()
  data.instances = []
  data.launch_profiles![0].profile.qualification.tier = 'calculated-startup-smoke'
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  expect(screen.getByText('No tested profile is available for this GPU group.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
  const option = screen.getByRole('option', { name: /Estimated/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  expect(screen.getByText(/Full-length requests have not been tested/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeEnabled()
})

it('identifies the Engine recorded by full-context evidence without claiming a newer runtime passed', () => {
  const data = snapshot()
  data.instances = []
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  const option = screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  expect(screen.getByText(/Evidence applies to the recorded options and Engine 922e5a87/)).toBeInTheDocument()
  expect(screen.getByText(/A changed option or Engine needs separate validation/)).toBeInTheDocument()
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
  const selected = screen.getByRole('option', { name: /Vision \+ text$/ }) as HTMLOptionElement
  expect(screen.getByLabelText('Hardware profile')).toHaveValue(selected.value)
  expect(launch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
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
  expect(screen.getByRole('option', { name: /Untested/ })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Recommended/ })).not.toBeInTheDocument()
})

it('keeps the existing untested Vision default alongside a tested text recommendation', () => {
  const data = snapshot()
  data.instances = []
  const vision = structuredClone(data.launch_profiles![0])
  vision.profile.id = 'pending-vision'
  vision.profile.name = 'Pending Vision'
  vision.profile.options.vision = true
  vision.profile.qualification.tier = 'calculated-pending-validation'
  data.launch_profiles!.push(vision)
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  const selected = screen.getByRole('option', { name: 'Untested · C4 · 32K context · Vision + text' }) as HTMLOptionElement
  expect(screen.getByLabelText('Hardware profile')).toHaveValue(selected.value)
  expect(screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' })).toBeInTheDocument()
  expect(launch).not.toHaveBeenCalled()
})

it('shows one tested recommendation and preserves an alternate selection when collapsing', async () => {
  const data = snapshot()
  data.instances = []
  const template = data.launch_profiles![0]
  template.profile.options.vision = true
  template.profile.concurrency = 1
  const otherTested = structuredClone(template)
  otherTested.profile.id = 'tested-c4'
  otherTested.profile.name = 'Tested C4'
  otherTested.profile.concurrency = 4
  const estimated = structuredClone(template)
  estimated.profile.id = 'estimated'
  estimated.profile.name = 'Estimated C2'
  estimated.profile.concurrency = 2
  estimated.profile.qualification.tier = 'calculated-startup-smoke'
  const untested = structuredClone(template)
  untested.profile.id = 'untested'
  untested.profile.name = 'Untested C8'
  untested.profile.concurrency = 8
  untested.profile.qualification.tier = 'calculated-pending-validation'
  data.launch_profiles!.push(otherTested, estimated, untested)
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  expect(screen.getAllByRole('option', { name: /Recommended/ })).toHaveLength(1)
  expect(screen.queryByRole('option', { name: /^(Tested · C4|Estimated · C2|Untested · C8)/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
  expect(screen.getByRole('option', { name: 'Tested · C4 · 32K context · Vision + text' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Estimated · C2 · 32K context · Vision + text' })).toBeInTheDocument()
  const alternate = screen.getByRole('option', { name: 'Untested · C8 · 32K context · Vision + text' }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: alternate.value } })
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
  expect(screen.getByLabelText('Hardware profile')).toHaveValue(alternate.value)
  expect(screen.queryByRole('option', { name: /^(Tested · C4|Estimated · C2)/ })).not.toBeInTheDocument()
  expect(screen.getByText(/Startup, memory margin and inference are unverified/)).toBeInTheDocument()
  expect(launch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Start Server Instance' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith({ profile_id: 'untested', model_id: 'model', gpu_uuids: ['GPU-one'],
    instance_id: null, force: false, structured_outputs: true }))
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
  const initial = screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' }) as HTMLOptionElement
  fireEvent.change(profile, { target: { value: initial.value } })
  expect(visibleProfileIds()).toEqual(['fixture-c4'])
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'qwen' } })
  expect(profile).toHaveValue('')
  expect(visibleProfileIds()).toEqual(['qwen-c4'])
  expect(screen.getByRole('button', { name: 'Apply profile and restart' })).toBeDisabled()
  expect(launch).not.toHaveBeenCalled()
})

it('selects physical GPUs separately and filters profiles before launching', async () => {
  const data = snapshot()
  data.instances = []
  data.gpus.push({ uuid: 'GPU-two', name: 'NVIDIA Graphics Device', display_name: 'NVIDIA CMP 170HX', memory_mib: 65536 })
  const second = structuredClone(data.launch_profiles![0])
  second.profile.id = 'second'
  second.profile.name = 'Second GPU profile'
  second.compatible_gpu_groups = [['GPU-two']]
  data.launch_profiles!.push(second)
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={data} instanceId="" disabled={false} launch={launch} />)
  const gpu = screen.getByLabelText('GPU / GPU group')
  expect(gpu).toHaveValue(JSON.stringify(['GPU-one']))
  expect(screen.getByRole('option', { name: 'GPU 2: NVIDIA CMP 170HX · 64 GB' })).toHaveValue(JSON.stringify(['GPU-two']))
  expect(visibleProfileIds()).toEqual(['fixture-c4'])
  const first = screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: first.value } })
  fireEvent.change(gpu, { target: { value: JSON.stringify(['GPU-two']) } })
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeDisabled()
  expect(visibleProfileIds()).toEqual(['second'])
  const option = screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' }) as HTMLOptionElement
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

it('holds profile launches when the Host reports hardware profiling in progress', () => {
  const data = snapshot()
  data.instances = []
  data.launch_profiles![0].gpu_groups = [['GPU-one']]
  data.hardware_profile = { status: 'running', pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', job_id: 'job', pid: 42, reprofile: false,
    started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: false, diagnostic_tail: '', error: null, available: true }
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeDisabled()
  expect(screen.getByLabelText('Hardware profile')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Start Server Instance' }))
  expect(launch).not.toHaveBeenCalled()
})

it.each(['running', 'cancelling'] as const)('launches a selected profile during %s optional completion', async (status) => {
  const data = snapshot()
  data.instances = []
  data.hardware_profile = { status, scope: 'complete_remaining_formats', base_complete: true,
    pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', job_id: 'job', pid: 42, reprofile: false,
    started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: true, diagnostic_tail: '', error: null, available: true }
  const launch = vi.fn(async () => {
    view.rerender(<EngineProfilePicker snapshot={{ ...data, instances: [{
      instance_id: 'loaded', session_id: 'session', display_name: 'Muse', upstream_model_id: 'muse', status: 'ready',
      configuration: { gpu_uuids: ['GPU-one'], max_context: 32768, concurrency: 4 },
    }] }} disabled={false} launch={launch} />)
  })
  const view = render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  expect(screen.getByLabelText('Hardware profile')).toBeEnabled()
  const option = screen.getByRole('option', { name: 'Recommended · Tested · C4 · 32K context · Text only' }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  expect(screen.getByRole('button', { name: 'Start Server Instance' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Start Server Instance' }))
  expect(await screen.findByRole('option', { name: /Muse.*ready/ })).toBeInTheDocument()
  expect(launch).toHaveBeenCalledWith({ profile_id: 'fixture-c4', model_id: 'model', gpu_uuids: ['GPU-one'],
    instance_id: null, force: false, structured_outputs: true })
})

it('labels screened PRO settings without recommending or increasing their witnessed context', () => {
  const data = snapshot()
  data.instances = []
  const entry = data.launch_profiles![0]
  entry.profile.max_context = 131072
  entry.profile.concurrency = 8
  entry.profile.options.vision = true
  entry.profile.qualification.tier = 'screened-startup'
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  expect(screen.getByRole('option', { name: 'Screened, not full-context qualified · C8 · 128K context · Vision + text' })).toBeInTheDocument()
  expect(screen.getByText(/Startup and short requests were checked; full-context capacity is unverified/)).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Recommended/ })).not.toBeInTheDocument()
  expect(launch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Start Server Instance' }))
  expect(launch).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'fixture-c4', gpu_uuids: ['GPU-one'] }))
  expect(screen.queryByText(/256K/)).not.toBeInTheDocument()
})
