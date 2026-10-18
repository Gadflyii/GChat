import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineHardwareProfile } from '../EngineHardwareProfile'
import type { EngineHardwareProfile as HardwareProfileStatus } from '@/services/engines'

afterEach(cleanup)

it('shows calibration failures and offline status without blocking model or hardware controls', () => {
  const action = vi.fn().mockResolvedValue(undefined)
  const calibrations = [{ key: 'recipe', model_id: 'Qwen', gpu_uuids: ['GPU-one'],
    max_context: 131072, concurrency: 4, status: 'failed' as const, pid: null,
    error: 'Calibration rejected', diagnostic_tail: 'Native capacity error' }]
  const view = render(<EngineHardwareProfile gpus={gpus} profile={profile('completed')}
    offline={false} disabled={false} action={action} calibrations={calibrations} />)
  const region = screen.getByRole('region', { name: 'Model speed tuning' })
  expect(region).toHaveTextContent('4 requests at once · 131,072 tokens per conversation · Could not finish')
  expect(region).toHaveTextContent('Graphics card 1: RTX 5090')
  expect(screen.getByRole('alert')).toHaveTextContent('Speed tuning could not finish')
  expect(screen.getByText('Calibration rejected')).not.toBeVisible()
  fireEvent.click(screen.getByText('Speed tuning technical details'))
  expect(screen.getByText('Calibration rejected')).toBeVisible()
  expect(region).toHaveTextContent('Native capacity error')
  expect(screen.getByRole('checkbox')).toBeEnabled()
  view.rerender(<EngineHardwareProfile gpus={gpus} profile={profile('completed')}
    offline disabled={false} action={action} calibrations={calibrations} />)
  expect(region).toHaveTextContent('last reported; computer not reachable')
  expect(action).not.toHaveBeenCalled()
})
const gpus = [{ uuid: 'GPU-one', name: 'RTX 5090', memory_mib: 32000, compute_capability: '12.0' }]
const profile = (status: HardwareProfileStatus['status']): HardwareProfileStatus => ({
  status, pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', job_id: 'job', pid: null, reprofile: false, started_unix_ms: 1000,
  finished_unix_ms: null, profile_path: '/hardware.json', checkpoint_available: false,
  diagnostic_tail: 'Measuring CPU groups', error: null, available: true,
})

it('observes the same running job without launching or cancelling it when mounted or closed', () => {
  const action = vi.fn().mockResolvedValue(undefined)
  const view = render(<EngineHardwareProfile gpus={gpus} profile={profile('running')} offline={false} disabled={false} action={action} />)
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value')
  expect(screen.getByText('Measuring CPU groups')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Measure again' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Stop setup' }))
  expect(action).toHaveBeenCalledExactlyOnceWith('cancel')
  view.rerender(<EngineHardwareProfile gpus={gpus} profile={profile('cancelling')} offline={false} disabled={false} action={action} />)
  expect(screen.getByRole('button', { name: 'Stopping setup…' })).toBeDisabled()
  view.unmount()
  expect(action).toHaveBeenCalledTimes(1)
})

it('shows checkpoint uncertainty and errors, disables offline actions and renders completion from the Host', () => {
  const action = vi.fn().mockResolvedValue(undefined)
  const interrupted = { ...profile('interrupted'), checkpoint_available: true, error: 'Host interrupted the producer' }
  const view = render(<EngineHardwareProfile gpus={gpus} profile={interrupted} offline disabled={false} action={action} />)
  expect(screen.getByText(/Some progress has been saved/)).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Graphics-card setup could not finish')
  expect(screen.getByText(interrupted.error)).not.toBeVisible()
  fireEvent.click(screen.getByText('Setup error details'))
  expect(screen.getByText(interrupted.error)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Continue setup' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Measure again' })).toBeDisabled()
  view.rerender(<EngineHardwareProfile gpus={gpus} profile={interrupted} offline={false} disabled={false} action={action} />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }))
  expect(action).toHaveBeenCalledExactlyOnceWith('resume')
  view.rerender(<EngineHardwareProfile gpus={gpus} profile={{ ...profile('completed'), finished_unix_ms: 62000 }} offline={false} disabled={false} action={action} />)
  expect(screen.getByRole('status')).toHaveTextContent('Graphics-card settings ready · 61 seconds elapsed')
  expect(screen.getByText(/do not guarantee that every model or conversation length will fit/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Continue setup' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Measure again' }))
  expect(action).toHaveBeenLastCalledWith('refresh', ['GPU-one'])
})

it('requires an explicit singleton choice even before the Host has a group-bound profiler', () => {
  const action = vi.fn().mockResolvedValue(undefined)
  render(<EngineHardwareProfile gpus={gpus} profile={{ ...profile('idle'), gpu_uuids: [], engine_path: null, available: false }} offline={false} disabled={false} action={action} />)
  expect(action).not.toHaveBeenCalled()
  expect(screen.getByRole('group', { name: 'Choose graphics cards' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Measure graphics cards' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Measure graphics cards' }))
  expect(action).toHaveBeenCalledExactlyOnceWith('ensure', ['GPU-one'])
})

it('preserves explicit GPU order and disables mixed-SM or mixed-model selections', () => {
  const devices = [...gpus, { ...gpus[0], uuid: 'GPU-two' },
    { ...gpus[0], uuid: 'GPU-ada', name: 'RTX 4090', compute_capability: '8.9' },
    { ...gpus[0], uuid: 'GPU-pro', name: 'RTX PRO 6000' }]
  const action = vi.fn().mockResolvedValue(undefined)
  render(<EngineHardwareProfile gpus={devices} profile={{ ...profile('idle'), gpu_uuids: [] }} offline={false} disabled={false} action={action} />)
  const device = (uuid: string) => screen.getByRole('checkbox', { name: new RegExp(`Graphics card ${devices.findIndex(gpu => gpu.uuid === uuid) + 1}:`) })
  fireEvent.click(device('GPU-two'))
  expect(device('GPU-ada')).toBeDisabled()
  expect(device('GPU-pro')).toBeDisabled()
  fireEvent.click(device('GPU-one'))
  fireEvent.click(screen.getByRole('button', { name: 'Measure graphics cards' }))
  expect(action).toHaveBeenCalledExactlyOnceWith('ensure', ['GPU-two', 'GPU-one'])
  fireEvent.click(device('GPU-two'))
  fireEvent.click(device('GPU-one'))
  expect(device('GPU-ada')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Measure graphics cards' })).toBeDisabled()
})

it('shows queued and exact stale groups without inferring stale state or starting their profiling', () => {
  const devices = [...gpus, { ...gpus[0], uuid: 'GPU-two' }]
  const action = vi.fn().mockResolvedValue(undefined)
  const view = render(<EngineHardwareProfile gpus={devices} profile={{ ...profile('failed'), error: 'An unrelated startup failure' }} offline={false} disabled={false} action={action} />)
  expect(screen.queryByText(/Your hardware has changed/)).not.toBeInTheDocument()
  view.rerender(<EngineHardwareProfile gpus={devices} profile={{ ...profile('interrupted'), pending_gpu_groups: [['GPU-two']],
    stale_groups: [
      { gpu_uuids: ['GPU-one'], profile_path: '/group-one/hardware.json', expected_duration_ms: 120000 },
      { gpu_uuids: ['GPU-two'], profile_path: '/group-two/hardware.json', expected_duration_ms: null },
    ] }} offline={false} disabled={false} action={action} />)
  expect(screen.getByText('More groups of graphics cards are waiting for setup')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue setup' })).toBeEnabled()
  expect(screen.getByText(/Select Continue setup to try again with your saved choices/)).toBeInTheDocument()
  expect(screen.getByText(/Your hardware has changed. Measure these cards again. Estimated time: 2 minutes/)).toBeInTheDocument()
  expect(screen.getByText(/Your hardware has changed. Measure these cards again. Allow 10 minutes to an hour or longer/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('region', { name: /Graphics cards needing new settings.*Graphics card 2:/ }).querySelector('button')!)
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Measure again' }))
  expect(action).toHaveBeenCalledExactlyOnceWith('refresh', ['GPU-two'])
  view.rerender(<EngineHardwareProfile gpus={devices} profile={{ ...profile('running'), pending_gpu_groups: [['GPU-two']] }} offline={false} disabled={false} action={action} />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop setup for all groups' }))
  expect(action).toHaveBeenLastCalledWith('cancel')
})

it('explains building a profile before choices and keeps technical paths out of the main instructions', () => {
  render(<EngineHardwareProfile gpus={gpus} profile={profile('idle')} offline={false} disabled={false} action={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Graphics-card setup' })).toBeInTheDocument()
  expect(screen.getByText(/Reusing these results helps models load and switch faster/)).toBeInTheDocument()
  expect(screen.getByText(/Each combination needs its own saved settings/)).toBeInTheDocument()
  const details = screen.getByText('Technical details').closest('details')!
  expect(details).not.toHaveAttribute('open')
  expect(details).toHaveTextContent('/bin/ginfer')
  expect(details).toHaveTextContent('GPU-one')
  expect(screen.getByRole('checkbox', { name: 'Graphics card 1: RTX 5090' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Measure graphics cards' })).toBeDisabled()
})

it('drops the how-long-it-takes note once the profile is ready and keeps it while profiling', () => {
  const view = render(<EngineHardwareProfile gpus={gpus} profile={profile('running')} offline={false} disabled={false} action={vi.fn()} />)
  expect(screen.getByText(/Allow 10 minutes to an hour/)).toBeInTheDocument()
  view.rerender(<EngineHardwareProfile gpus={gpus} profile={profile('completed')} offline={false} disabled={false} action={vi.fn()} />)
  expect(screen.queryByText(/Allow 10 minutes to an hour/)).not.toBeInTheDocument()
  expect(screen.getByText(/Your graphics-card settings are ready/)).toBeInTheDocument()
})
