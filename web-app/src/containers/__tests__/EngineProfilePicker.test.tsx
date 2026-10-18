import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { spyConfirm } from '@/test/confirm'
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
      options: { vision: false }, qualification: { tier: 'full-context-tested', engine_revision: '922e5a879b9af12e52763d52b73362937f9dd148' } } }],
})

it('reserves other instances GPUs and requires confirmation before switching their profile', async () => {
  const user = userEvent.setup()
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={snapshot()} disabled={false} launch={launch} />)
  expect(screen.getByLabelText('Saved model settings')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start model' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Model server', exact: true }))
  await user.click(screen.getByRole('menuitemradio', { name: /Muse.*Ready to chat/ }))
  expect(screen.getByLabelText('Saved model settings')).toBeEnabled()
  expect(screen.getByLabelText('Graphics cards')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 4 replies at once · 32K tokens · Text only' }))
  const confirm = spyConfirm().mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings and restart' }))
  expect(launch).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings and restart' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith({ profile_id: 'fixture-c4', model_id: 'model',
    gpu_uuids: ['GPU-one'], instance_id: 'existing', force: false, structured_outputs: true, expected_session_id: 'session' }))
  expect(screen.getByRole('button', { name: 'Model server', exact: true })).toHaveTextContent(/Muse.*Ready to chat/)
})

it('keeps offline snapshots read-only and does not invent missing profiles', () => {
  const data = snapshot()
  data.launch_profiles = []
  data.models = []
  render(<EngineProfilePicker snapshot={data} disabled launch={vi.fn()} />)
  expect(screen.getByText(/No installed models were found/)).toBeInTheDocument()
  expect(screen.getByLabelText('Model server')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start model' })).toBeDisabled()
})

it('preserves saved structured-output OFF when applying a qualified profile', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances[0].profile = {
    model_id: 'model', gpu_uuids: ['GPU-one'], max_context: 8192, concurrency: 1,
    vision: false, structured_outputs: false, spec: 'none', draft_tokens: 0, draft_tp: 0,
    kv_dtype: 'auto', kv_arena_bytes: null, host_kv_cache_bytes: 0, prefill_chunk: 0, no_cuda_graph: false,
  }
  const launch = vi.fn().mockResolvedValue(undefined)
  spyConfirm().mockReturnValue(true)
  render(<EngineProfilePicker snapshot={data} instanceId="existing" disabled={false} launch={launch} />)
  const structured = screen.getByRole('checkbox', { name: 'Follow a response format' })
  expect(structured).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 4 replies at once · 32K tokens · Text only' }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings and restart' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ structured_outputs: false })))
  fireEvent.click(structured)
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings and restart' }))
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
    expect(screen.getByRole('checkbox', { name: 'Follow a response format' })).toBeChecked()
    expect(screen.getByText(/These settings have not been tested together/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start model' }))
    await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ structured_outputs: true })))
    view.unmount()
  }
})

it('distinguishes calculated smoke evidence from full-context testing', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances = []
  data.launch_profiles![0].profile.qualification.tier = 'calculated-startup-smoke'
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  expect(screen.getByText('No settings with full-length conversation tests are available for these cards.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show all settings' }))
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  await user.click(screen.getByRole('menuitemradio', { name: /Memory estimated/ }))
  expect(screen.getByText(/Full-length conversations have not been tested/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start model' })).toBeEnabled()
})

it('identifies the Engine recorded by full-context evidence without claiming a newer runtime passed', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances = []
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 4 replies at once · 32K tokens · Text only' }))
  expect(screen.getByText(/Changed settings or another GInfer version need their own tests/)).toBeVisible()
  const revision = screen.getByText('GInfer revision used for testing: 922e5a87')
  expect(revision).not.toBeVisible()
  fireEvent.click(screen.getByText('Saved settings technical details'))
  expect(revision).toBeVisible()
})

it('defaults new instances to an available Vision profile without starting it', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances = []
  const vision = structuredClone(data.launch_profiles![0])
  vision.profile.id = 'vision'
  vision.profile.options.vision = true
  data.launch_profiles!.push(vision)
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getByRole('menuitemradio', { name: /Images and text$/ })).toHaveAttribute('aria-checked', 'true')
  await user.keyboard('{Escape}')
  expect(launch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Show all settings' }))
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  await user.click(screen.getByRole('menuitemradio', { name: /Text only/ }))
  expect(screen.getByRole('button', { name: 'Saved model settings' })).toHaveTextContent('Text only')
})

it('keeps pending Vision profiles selectable and warns about unverified startup', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances = []
  data.launch_profiles![0].profile.options.vision = true
  data.launch_profiles![0].profile.qualification.tier = 'calculated-pending-validation'
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  expect(screen.getByText(/Starting the model, available memory and replies have not been tested/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start model' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getByRole('menuitemradio', { name: /Not yet tested/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByRole('menuitemradio', { name: /Recommended/ })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
})

it('keeps the existing untested Vision default alongside a tested text recommendation', async () => {
  const user = userEvent.setup()
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
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getByRole('menuitemradio', { name: 'Not yet tested · 4 replies at once · 32K tokens · Images and text' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 4 replies at once · 32K tokens · Text only' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(launch).not.toHaveBeenCalled()
})

it('shows one tested recommendation and preserves an alternate selection when collapsing', async () => {
  const user = userEvent.setup()
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
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getAllByRole('menuitemradio', { name: /Recommended/ })).toHaveLength(1)
  expect(screen.queryByRole('menuitemradio', { name: /^(Full conversations tested · 4|Memory estimated; short conversations tested · 2|Not yet tested · 8)/ })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  fireEvent.click(screen.getByRole('button', { name: 'Show all settings' }))
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getByRole('menuitemradio', { name: 'Full conversations tested · 4 replies at once · 32K tokens · Images and text' })).toBeInTheDocument()
  expect(screen.getByRole('menuitemradio', { name: 'Memory estimated; short conversations tested · 2 replies at once · 32K tokens · Images and text' })).toBeInTheDocument()
  await user.click(screen.getByRole('menuitemradio', { name: 'Not yet tested · 8 replies at once · 32K tokens · Images and text' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show fewer settings' }))
  expect(screen.getByRole('button', { name: 'Saved model settings' })).toHaveTextContent('Not yet tested · 8 replies at once · 32K tokens · Images and text')
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getByRole('menuitemradio', { name: 'Not yet tested · 8 replies at once · 32K tokens · Images and text' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByRole('menuitemradio', { name: /^(Full conversations tested · 4|Memory estimated; short conversations tested · 2)/ })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.getByText(/Starting the model, available memory and replies have not been tested/)).toBeInTheDocument()
  expect(launch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Start model' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith({ profile_id: 'untested', model_id: 'model', gpu_uuids: ['GPU-one'],
    instance_id: null, force: false, structured_outputs: true }))
})

it('filters profiles by model and assigned hardware and clears a previous model choice', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.models.push({ ...data.models[0], id: 'qwen', metadata: { ...data.models[0].metadata,
    identity: { model_id: 'qwen3.8-27b', weights_id: 'nvfp4' } } })
  data.gpus.push({ ...data.gpus[0], uuid: 'GPU-two' })
  const qwen = structuredClone(data.launch_profiles![0])
  qwen.model_id = 'qwen'
  qwen.profile.id = 'qwen-c4'
  qwen.profile.name = 'Qwen C2'
  qwen.profile.concurrency = 2
  const otherGpu = structuredClone(qwen)
  otherGpu.profile.id = 'other-gpu'
  otherGpu.profile.name = 'Other GPU profile'
  otherGpu.profile.concurrency = 3
  otherGpu.compatible_gpu_groups = [['GPU-two']]
  const unsupported = structuredClone(qwen)
  unsupported.profile.name = 'Unsupported hardware'
  unsupported.profile.concurrency = 8
  unsupported.compatible_gpu_groups = []
  data.launch_profiles!.push(qwen, otherGpu, unsupported)
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} instanceId="existing" disabled={false} launch={launch} />)
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  await user.click(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 4 replies at once · 32K tokens · Text only' }))
  await user.click(screen.getByRole('button', { name: 'Model', exact: true }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Qwen 3.8 27B — NVFP4' }))
  expect(screen.getByRole('button', { name: 'Saved model settings' })).toHaveTextContent('Choose saved settings')
  expect(screen.queryByRole('button', { name: 'Show all settings' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  expect(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 2 replies at once · 32K tokens · Text only' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitemradio', { name: /[348] replies at once/ })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Apply settings and restart' })).toBeDisabled()
  expect(launch).not.toHaveBeenCalled()
})

it('selects physical GPUs separately and filters profiles before launching', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances = []
  data.gpus.push({ uuid: 'GPU-two', name: 'NVIDIA Graphics Device', display_name: 'NVIDIA CMP 170HX', memory_mib: 65536 })
  const second = structuredClone(data.launch_profiles![0])
  second.profile.id = 'second'
  second.profile.name = 'Second GPU profile'
  second.profile.concurrency = 8
  second.compatible_gpu_groups = [['GPU-two']]
  data.launch_profiles!.push(second)
  const launch = vi.fn().mockResolvedValue(undefined)
  render(<EngineProfilePicker snapshot={data} instanceId="" disabled={false} launch={launch} />)
  expect(screen.getByRole('button', { name: 'Graphics cards' })).toHaveTextContent('Graphics card 1: Fixture GPU · 32 GiB')
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  await user.click(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 4 replies at once · 32K tokens · Text only' }))
  await user.click(screen.getByRole('button', { name: 'Graphics cards' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Graphics card 2: NVIDIA CMP 170HX · 64 GiB' }))
  expect(screen.getByRole('button', { name: 'Graphics cards' })).toHaveTextContent('Graphics card 2: NVIDIA CMP 170HX · 64 GiB')
  expect(screen.getByRole('button', { name: 'Start model' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Show all settings' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  expect(screen.queryByRole('menuitemradio', { name: /4 replies at once/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 8 replies at once · 32K tokens · Text only' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start model' }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ gpu_uuids: ['GPU-two'], profile_id: 'second' })))
})

it('offers declared TP groups and explains cards without a matching profile', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances = []
  data.gpus.push({ ...data.gpus[0], uuid: 'GPU-two' }, { uuid: 'GPU-three', name: 'Different GPU', memory_mib: 24576 })
  data.launch_profiles![0].profile.tp = 2
  data.launch_profiles![0].compatible_gpu_groups = [['GPU-one', 'GPU-two']]
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  expect(screen.getByRole('button', { name: 'Graphics cards' })).toHaveTextContent('Graphics card 1: Fixture GPU · 32 GiB + Graphics card 2: Fixture GPU · 32 GiB')
  await user.click(screen.getByRole('button', { name: 'Graphics cards' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Graphics card 3: Different GPU · 24 GiB' }))
  expect(screen.getByLabelText('Saved model settings')).toBeDisabled()
  expect(screen.getByText(/No saved settings fit this model on the selected graphics cards/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start model' })).toBeDisabled()
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
  expect(screen.getByRole('button', { name: 'Start model' })).toBeDisabled()
  expect(screen.getByLabelText('Saved model settings')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Start model' }))
  expect(launch).not.toHaveBeenCalled()
})

it.each(['running', 'cancelling'] as const)('launches a selected profile during %s optional completion', async (status) => {
  const user = userEvent.setup()
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
  expect(screen.getByLabelText('Saved model settings')).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Recommended · Full conversations tested · 4 replies at once · 32K tokens · Text only' }))
  expect(screen.getByRole('button', { name: 'Start model' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Start model' }))
  await user.click(screen.getByRole('button', { name: 'Model server', exact: true }))
  expect(await screen.findByRole('menuitemradio', { name: /Muse.*Ready to chat/ })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(launch).toHaveBeenCalledWith({ profile_id: 'fixture-c4', model_id: 'model', gpu_uuids: ['GPU-one'],
    instance_id: null, force: false, structured_outputs: true })
})

it('labels screened PRO settings without recommending or increasing their witnessed context', async () => {
  const user = userEvent.setup()
  const data = snapshot()
  data.instances = []
  const entry = data.launch_profiles![0]
  entry.profile.max_context = 131072
  entry.profile.concurrency = 8
  entry.profile.options.vision = true
  entry.profile.qualification.tier = 'screened-startup'
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  await user.click(screen.getByRole('button', { name: 'Saved model settings' }))
  expect(screen.getByRole('menuitemradio', { name: 'Short conversations tested · 8 replies at once · 128K tokens · Images and text' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByRole('menuitemradio', { name: /Recommended/ })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.getByText(/Starting the model and short conversations were tested. Full-length conversations and whether they fit in memory have not been tested/)).toBeInTheDocument()
  expect(launch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Start model' }))
  expect(launch).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'fixture-c4', gpu_uuids: ['GPU-one'] }))
  expect(screen.queryByText(/256K/)).not.toBeInTheDocument()
})

it('explains a missing profile in plain words and points to the next step', () => {
  const data = snapshot()
  data.instances = []
  data.launch_profiles = []
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={vi.fn()} />)
  expect(screen.getByText(/No saved settings fit this model on this computer yet/)).toBeInTheDocument()
  expect(document.body).not.toHaveTextContent(/draft format and TP degree/)
})

it('explains unreadable saved settings and keeps the original error available on request', () => {
  const data = snapshot()
  data.launch_profiles = []
  data.profile_error = 'profile schema version 99 is not supported'
  const launch = vi.fn()
  render(<EngineProfilePicker snapshot={data} disabled={false} launch={launch} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not read the saved model settings. Refresh the model list and try again.')
  const diagnostic = screen.getByText(data.profile_error)
  expect(diagnostic).not.toBeVisible()
  fireEvent.click(screen.getByText('Saved settings technical details'))
  expect(diagnostic).toBeVisible()
  expect(launch).not.toHaveBeenCalled()
})
