import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import KvmSetup from './KvmSetup'
import { settleConfirm, useConfirmStore } from '@/lib/confirm'
const { call, events } = vi.hoisted(() => ({
  call: vi.fn(),
  events: { update: null as null | (() => void) },
}))
vi.mock('@/services/gbot', () => ({ gbot: call }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event, callback) => {
    events.update = callback
    return Promise.resolve(vi.fn())
  }),
}))
afterEach(() => {
  cleanup()
  settleConfirm(false)
  call.mockReset()
  events.update = null
})
it.each([
  ['kvm', 'This setup uses Linux KVM.', '/data/GChat/gbot/vms'],
  [
    'hyper_v',
    'This setup uses Windows Hyper-V to run a separate Linux desktop.',
    'C:\\GChat\\gbot\\vms',
  ],
])(
  'explains the detected %s service computer without starting it',
  async (hypervisor, description, storagePath) => {
    call.mockImplementation(async (path) =>
      path === 'setup/local-vm/preflight'
        ? {
            hypervisor,
            storage_path: storagePath,
            ready: true,
            issues: [],
            cpus: 2,
            memory_mib: 4096,
            disk_gib: 40,
          }
        : []
    )
    render(<KvmSetup name="Writer" connected={vi.fn()} />)
    expect(await screen.findByText(description, { exact: false })).toBeVisible()
    expect(
      screen.getByText(/2 CPU threads, 4 GiB memory and a 40 GiB virtual disk/)
    ).toBeVisible()
    expect(
      screen.getByText(`Local VM files on the service computer: ${storagePath}`)
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Create Writer’s computer' })
    ).toBeEnabled()
    expect(call.mock.calls).toEqual([
      ['setup/local-vm/preflight', {}],
      ['setup/local-vm/status', {}],
    ])
  }
)

it('shows the Windows detection issue and leaves enabling Hyper-V and rebooting to the user', async () => {
  call.mockImplementation(async (path) =>
    path === 'setup/local-vm/preflight'
      ? {
          hypervisor: 'hyper_v',
          ready: false,
          issues: [
            {
              code: 'hyper_v_disabled',
              message: 'Hyper-V is not enabled on this Windows computer.',
              next_action:
                'Enable Hyper-V in Windows Features, reboot this computer, then check prerequisites again.',
            },
          ],
        }
      : []
  )
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  expect(
    await screen.findByText('Hyper-V is not enabled on this Windows computer.')
  ).toBeVisible()
  expect(
    screen.getByText(
      'Enable Hyper-V in Windows Features, reboot this computer, then check prerequisites again.'
    )
  ).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: 'Create Writer’s computer' })
  )
  expect(call.mock.calls.map(([path]) => path)).toEqual([
    'setup/local-vm/preflight',
    'setup/local-vm/status',
  ])
})

it.each(['kvm', 'hyper_v'])(
  'stops and restarts the same %s computer, preserving retry controls after failures',
  async (hypervisor) => {
    let saved = { id: 'writer-id', name: 'Writer', stage: 'ready', issue: null }
    const firstStop = deferred<object>()
    let stops = 0
    let starts = 0
    call.mockImplementation(async (path) => {
      if (path === 'setup/local-vm/preflight')
        return { hypervisor, ready: true, issues: [] }
      if (path === 'setup/local-vm/status') return [saved]
      if (path === 'setup/local-vm/stop') {
        if (++stops === 1) {
          saved = { ...saved, stage: 'stopping_computer' }
          return firstStop.promise
        }
        saved = { ...saved, stage: 'stopped' }
        return saved
      }
      if (path === 'setup/local-vm/start') {
        if (++starts === 1)
          throw new Error('The saved computer could not start.')
        saved = { ...saved, stage: 'ready' }
        return saved
      }
      throw new Error(`Unexpected ${path}`)
    })
    const connected = vi.fn()
    render(
      <KvmSetup name="Other name" initialId={saved.id} connected={connected} />
    )
    const stop = await screen.findByRole('button', { name: 'Stop computer' })
    await waitFor(() => expect(stop).toBeEnabled())
    act(() => {
      stop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      stop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      screen
        .getByRole('button', { name: 'Use this computer' })
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(call.mock.calls.filter(([path]) => path.endsWith('/stop'))).toEqual([
      ['setup/local-vm/stop', { id: saved.id }],
    ])
    expect(
      screen.getByRole('button', { name: 'Stopping computer…' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Remove owned computer' })
    ).toBeDisabled()
    expect(connected).not.toHaveBeenCalled()
    await act(async () =>
      firstStop.reject(new Error('The guest did not shut down.'))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The guest did not shut down.'
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Stop computer' })
      ).toBeEnabled()
    )
    expect(
      screen.queryByRole('button', { name: 'Use this computer' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Resume setup' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start computer' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop computer' }))
    const start = await screen.findByRole('button', { name: 'Start computer' })
    await waitFor(() => expect(start).toBeEnabled())
    expect(screen.getByRole('status')).toHaveTextContent(
      'Its virtual disk and saved files are kept.'
    )
    expect(
      screen.queryByRole('button', { name: 'Use this computer' })
    ).not.toBeInTheDocument()
    fireEvent.click(start)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The saved computer could not start.'
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start computer' })
      ).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start computer' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Use this computer' })
      ).toBeEnabled()
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      call.mock.calls.filter(([path]) => /\/(start|stop|remove)$/.test(path))
    ).toEqual([
      ['setup/local-vm/stop', { id: saved.id }],
      ['setup/local-vm/stop', { id: saved.id }],
      ['setup/local-vm/start', { id: saved.id, name: saved.name }],
      ['setup/local-vm/start', { id: saved.id, name: saved.name }],
    ])
  }
)

it('shows exact missing asset action and refuses creation without falling back to LAN', async () => {
  call.mockImplementation((path) =>
    Promise.resolve(
      path.endsWith('preflight')
        ? {
            ready: false,
            issues: [
              {
                code: 'asset_missing',
                message: 'Approved guest image is missing.',
                next_action:
                  'Stage the accepted image at /data/vms/assets/image.qcow2 and retry.',
              },
            ],
          }
        : []
    )
  )
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  expect(
    await screen.findByText('Approved guest image is missing.')
  ).toBeInTheDocument()
  expect(screen.getByText(/Stage the accepted image at/)).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Create Writer’s computer' })
  ).toBeDisabled()
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
})
it('creates only after confirmation, shows event progress and retries the same owned identity', async () => {
  let record: {
    id: string
    name: string
    stage: string
    issue: null | { code: string; message: string; next_action: string }
  } | null = null
  call.mockImplementation((path, body) => {
    if (path.endsWith('preflight'))
      return Promise.resolve({ ready: true, issues: [] })
    if (path.endsWith('status')) return Promise.resolve(record ? [record] : [])
    if (path.endsWith('start')) {
      record = {
        id: body.id,
        name: body.name,
        stage: 'preparing_computer',
        issue: null,
      }
      return Promise.resolve(record)
    }
    return Promise.resolve([])
  })
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create Writer’s computer' })
    ).toBeEnabled()
  )
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
  fireEvent.click(
    screen.getByRole('button', { name: 'Create Writer’s computer' })
  )
  await screen.findByText(/Writer · Preparing the guest disk/)
  const first = call.mock.calls.find(([path]) => path.endsWith('/start'))?.[1]
  record = {
    ...first,
    stage: 'connecting',
    issue: {
      code: 'guest_not_ready',
      message: 'Cloud-init not ready.',
      next_action: 'Repair guest services and retry.',
    },
  }
  events.update?.()
  await screen.findByText('Cloud-init not ready.')
  fireEvent.click(screen.getByRole('button', { name: 'Resume setup' }))
  await waitFor(() =>
    expect(
      call.mock.calls.filter(([path]) => path.endsWith('/start'))
    ).toHaveLength(2)
  )
  expect(
    call.mock.calls.filter(([path]) => path.endsWith('/start'))[1][1]
  ).toEqual(first)
})

it('shows a pending recheck once and clears earlier readiness when it fails', async () => {
  let rejectCheck!: (reason: Error) => void
  const pendingCheck = new Promise((_, reject) => {
    rejectCheck = reject
  })
  let checks = 0
  call.mockImplementation((path) => {
    if (path.endsWith('preflight')) {
      checks += 1
      return checks === 2
        ? pendingCheck
        : Promise.resolve({ ready: true, issues: [] })
    }
    return Promise.resolve([])
  })
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  const create = screen.getByRole('button', {
    name: 'Create Writer’s computer',
  })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  )
  const checking = screen.getByRole('button', {
    name: 'Checking prerequisites…',
  })
  expect(checking).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking local VM prerequisites…'
  )
  expect(create).toBeDisabled()
  fireEvent.click(checking)
  fireEvent.click(create)
  expect(checks).toBe(2)
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
  rejectCheck(new Error('The Gbot service is unavailable.'))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The Gbot service is unavailable.'
  )
  expect(create).toBeDisabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  )
  await waitFor(() => expect(create).toBeEnabled())
  expect(checks).toBe(3)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('does not retain a successful preflight when refreshing saved setups fails', async () => {
  call.mockImplementation((path) =>
    path.endsWith('preflight')
      ? Promise.resolve({ ready: true, issues: [] })
      : Promise.reject(new Error('Saved setups could not be read.'))
  )
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Saved setups could not be read.'
  )
  expect(
    screen.getByRole('button', { name: 'Create Writer’s computer' })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  ).toBeEnabled()
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it.each([
  [
    'start',
    'Resume setup',
    'connecting',
    'Could not confirm Writer’s computer setup.',
  ],
  [
    'stop',
    'Stop computer',
    'ready',
    'Could not confirm that Writer’s computer stopped.',
  ],
  [
    'remove',
    'Remove owned computer',
    'ready',
    'Could not confirm that Writer’s computer was removed.',
  ],
  [
    'use',
    'Use this computer',
    'ready',
    'Could not connect to Writer’s computer.',
  ],
] as const)(
  'keeps failed %s guidance through prerequisite checks and event reads without replaying it',
  async (path, label, stage, guidance) => {
    const saved = { id: 'writer-id', name: 'Writer', stage, issue: null }
    const diagnostic = `local-vm ${path}: transport closed unexpectedly`
    let fail = true
    let failCheck = false
    let removed = false
    call.mockImplementation(async (requested) => {
      if (requested.endsWith('preflight')) {
        if (failCheck)
          throw new Error('Prerequisite check could not reach the service.')
        return { ready: true, issues: [] }
      }
      if (requested.endsWith('status')) return removed ? [] : [saved]
      if (fail) throw diagnostic
      if (path === 'remove') {
        removed = true
        return { ...saved, stage: 'removed' }
      }
      return saved
    })
    const connected = vi.fn(async () => {
      if (fail) throw new Error(diagnostic)
    })
    render(
      <KvmSetup name="Other bot" initialId={saved.id} connected={connected} />
    )
    const button = await screen.findByRole('button', { name: label })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    if (path === 'remove') await act(async () => settleConfirm(true))
    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent(guidance)
    const details = warning.querySelector('details')!
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent(diagnostic)
    expect(warning).toHaveTextContent('Check prerequisites again')
    const requests = () =>
      path === 'use'
        ? connected.mock.calls.length
        : call.mock.calls.filter(([requested]) =>
            requested.endsWith(`/${path}`)
          ).length
    expect(requests()).toBe(1)
    fireEvent.click(screen.getByText('Details'))
    expect(requests()).toBe(1)
    failCheck = true
    fireEvent.click(
      screen.getByRole('button', { name: 'Check prerequisites again' })
    )
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(warning).toHaveTextContent(guidance)
    expect(requests()).toBe(1)
    failCheck = false
    fireEvent.click(
      screen.getByRole('button', { name: 'Check prerequisites again' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Check prerequisites again' })
      ).toBeEnabled()
    )
    await act(async () => events.update?.())
    expect(screen.getByRole('alert')).toHaveTextContent(guidance)
    expect(requests()).toBe(1)
    if (path === 'remove') {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await act(async () => settleConfirm(false))
      expect(screen.getByRole('alert')).toHaveTextContent(guidance)
      expect(requests()).toBe(1)
    }
    fail = false
    fireEvent.click(screen.getByRole('button', { name: label }))
    if (path === 'remove') await act(async () => settleConfirm(true))
    await waitFor(() => expect(requests()).toBe(2))
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    )
  }
)

it.each(['kvm', 'hyper_v'])(
  'offers an explicit retry with the same %s identity when creation fails before saving a record',
  async (hypervisor) => {
    let saved: object | undefined
    let starts = 0
    const retry = deferred<object>()
    call.mockImplementation(async (path, body) => {
      if (path.endsWith('preflight'))
        return { hypervisor, ready: true, issues: [] }
      if (path.endsWith('status')) return saved ? [saved] : []
      if (path.endsWith('start')) {
        if (++starts === 1)
          throw new Error('Create failed before the record was saved.')
        const result = await retry.promise
        saved = { ...body, ...result }
        return saved
      }
      throw new Error(`Unexpected ${path}`)
    })
    render(<KvmSetup name="Writer" connected={vi.fn()} />)
    const create = screen.getByRole('button', {
      name: 'Create Writer’s computer',
    })
    await waitFor(() => expect(create).toBeEnabled())
    fireEvent.click(create)
    await screen.findByRole('alert')
    const button = screen.getByRole('button', {
      name: 'Retry Writer’s computer setup',
    })
    expect(button).toBeEnabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Check prerequisites again' })
    )
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not confirm Writer’s computer setup.'
    )
    expect(starts).toBe(1)
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(starts).toBe(2)
    const mutations = call.mock.calls.filter(([path]) => path.endsWith('/start'))
    expect(mutations[1][1]).toEqual(mutations[0][1])
    expect(screen.getByRole('button', { name: 'Starting setup…' })).toBeDisabled()
    await act(async () => retry.resolve({ stage: 'ready', issue: null }))
    expect(
      await screen.findByRole('button', { name: 'Use this computer' })
    ).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it('connects the chosen saved computer once, explains the wait and permits retry after failure', async () => {
  const attempt = deferred<void>()
  const connected = vi
    .fn()
    .mockReturnValueOnce(attempt.promise)
    .mockResolvedValue(undefined)
  const saved = { id: 'writer-id', name: 'Writer', stage: 'ready', issue: null }
  call.mockImplementation((path) =>
    Promise.resolve(
      path.endsWith('preflight') ? { ready: true, issues: [] } : [saved]
    )
  )
  render(
    <KvmSetup name="Different bot" initialId={saved.id} connected={connected} />
  )
  const use = await screen.findByRole('button', { name: 'Use this computer' })
  await waitFor(() => expect(use).toBeEnabled())
  const remove = screen.getByRole('button', { name: 'Remove owned computer' })
  act(() => {
    use.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    use.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(connected).toHaveBeenCalledExactlyOnceWith(saved.id)
  expect(call.mock.calls.some(([path]) => path.endsWith('/remove'))).toBe(false)
  expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Connecting to Writer’s computer…'
  )
  expect(remove).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  ).toBeDisabled()
  await act(async () =>
    attempt.reject(new Error('Connection lost. Try again.'))
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Connection lost. Try again.'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Use this computer' }))
  await waitFor(() => expect(connected).toHaveBeenCalledTimes(2))
  expect(connected).toHaveBeenLastCalledWith(saved.id)
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
})

it.each([
  [
    'start',
    'Resume setup',
    'Resuming setup…',
    'Starting Writer’s computer setup…',
  ],
  [
    'remove',
    'Remove owned computer',
    'Removing computer…',
    'Removing Writer’s owned computer…',
  ],
] as const)(
  'holds the exact saved %s action through its refresh and rejects concurrent actions',
  async (path, label, pendingLabel, status) => {
    const response = deferred<object>()
    const refresh = deferred<object[]>()
    const saved = {
      id: 'writer-id',
      name: 'Writer',
      stage: 'connecting',
      issue: null,
    }
    let statusReads = 0
    call.mockImplementation((requested) => {
      if (requested.endsWith('preflight'))
        return Promise.resolve({ ready: true, issues: [] })
      if (requested.endsWith('status'))
        return ++statusReads === 1 ? Promise.resolve([saved]) : refresh.promise
      return response.promise
    })
    render(
      <KvmSetup name="Different bot" initialId={saved.id} connected={vi.fn()} />
    )
    const action = await screen.findByRole('button', { name: label })
    await waitFor(() => expect(action).toBeEnabled())
    const other = screen.getByRole('button', {
      name: path === 'start' ? 'Remove owned computer' : 'Resume setup',
    })
    await act(async () => {
      action.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      if (path === 'remove') {
        settleConfirm(true)
        await Promise.resolve()
      }
      other.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      action.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const mutations = () =>
      call.mock.calls.filter(([requested]) =>
        /\/(start|remove)$/.test(requested)
      )
    expect(mutations()).toEqual([
      [
        `setup/local-vm/${path}`,
        path === 'start'
          ? { id: saved.id, name: saved.name }
          : { id: saved.id },
      ],
    ])
    expect(screen.getByRole('button', { name: pendingLabel })).toBeDisabled()
    expect(
      screen
        .getAllByRole('status')
        .some((element) => element.textContent === status)
    ).toBe(true)
    await act(async () => response.resolve(saved))
    expect(screen.getByRole('button', { name: pendingLabel })).toBeDisabled()
    await act(async () => refresh.resolve([saved]))
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    expect(mutations()).toHaveLength(1)
  }
)

it('creates one owned setup when Create is repeated before the first render', async () => {
  const response = deferred<object>()
  call.mockImplementation((path) => {
    if (path.endsWith('preflight'))
      return Promise.resolve({ ready: true, issues: [] })
    if (path.endsWith('status')) return Promise.resolve([])
    return response.promise
  })
  render(<KvmSetup name=" Writer " connected={vi.fn()} />)
  const create = screen.getByRole('button', {
    name: 'Create Writer’s computer',
  })
  await waitFor(() => expect(create).toBeEnabled())
  act(() => {
    create.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    create.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  const starts = call.mock.calls.filter(([path]) => path.endsWith('/start'))
  expect(starts).toHaveLength(1)
  expect(starts[0][1]).toEqual({ id: expect.any(String), name: 'Writer' })
  expect(screen.getByRole('status')).toHaveTextContent(
    'Starting Writer’s computer setup…'
  )
  expect(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  ).toBeDisabled()
  await act(async () =>
    response.resolve({ ...starts[0][1], stage: 'connecting', issue: null })
  )
})

it.each(['ready', 'connecting'])(
  'confirms deleting a %s computer and its saved files before any removal',
  async (stage) => {
    const saved = { id: 'writer-id', name: 'Writer', stage, issue: null }
    let records = [saved]
    call.mockImplementation((path) => {
      if (path.endsWith('preflight'))
        return Promise.resolve({ ready: true, issues: [] })
      if (path.endsWith('status')) return Promise.resolve(records)
      if (path.endsWith('remove')) {
        records = []
        return Promise.resolve({ ...saved, stage: 'removed' })
      }
      return Promise.resolve([])
    })
    render(
      <KvmSetup name="Different bot" initialId={saved.id} connected={vi.fn()} />
    )
    const remove = await screen.findByRole('button', {
      name: 'Remove owned computer',
    })
    await waitFor(() => expect(remove).toBeEnabled())
    fireEvent.click(remove)
    expect(call).not.toHaveBeenCalledWith('setup/local-vm/remove', expect.anything())
    const pending = useConfirmStore.getState().pending
    expect(pending).toMatchObject({
      title: 'Delete Writer’s computer?',
      confirmLabel: 'Delete computer',
      destructive: true,
    })
    expect(pending?.message).toContain('all files saved on it')
    expect(pending?.message).toContain('cannot be undone')
    await act(async () => settleConfirm(false))
    expect(call).not.toHaveBeenCalledWith('setup/local-vm/remove', expect.anything())
    expect(remove).toBeEnabled()

    fireEvent.click(remove)
    await act(async () => settleConfirm(true))
    expect(call).toHaveBeenCalledWith('setup/local-vm/remove', { id: saved.id })
    expect(
      call.mock.calls.filter(([path]) => path.endsWith('/remove'))
    ).toHaveLength(1)
    await waitFor(() =>
      expect(
        screen.queryByText('Saved local computer setups')
      ).not.toBeInTheDocument()
    )
  }
)

it('does not delete a computer when its confirmation is accepted after leaving setup', async () => {
  const saved = { id: 'writer-id', name: 'Writer', stage: 'ready', issue: null }
  call.mockImplementation((path) =>
    Promise.resolve(
      path.endsWith('preflight') ? { ready: true, issues: [] } : [saved]
    )
  )
  const { unmount } = render(
    <KvmSetup name="Different bot" initialId={saved.id} connected={vi.fn()} />
  )
  const remove = await screen.findByRole('button', {
    name: 'Remove owned computer',
  })
  await waitFor(() => expect(remove).toBeEnabled())
  fireEvent.click(remove)
  expect(useConfirmStore.getState().pending).not.toBeNull()
  unmount()
  await act(async () => settleConfirm(true))
  expect(call).not.toHaveBeenCalledWith('setup/local-vm/remove', expect.anything())
})

it.each(['reply', 'error'] as const)(
  'does not resurrect a removed computer when an earlier event status returns a late %s',
  async (outcome) => {
    const saved = {
      id: 'writer-id',
      name: 'Writer',
      stage: 'connecting',
      issue: null,
    }
    const oldStatus = deferred<object[]>()
    const removal = deferred<object>()
    const freshStatus = deferred<object[]>()
    let statusReads = 0
    call.mockImplementation((path) => {
      if (path.endsWith('preflight'))
        return Promise.resolve({ ready: true, issues: [] })
      if (path.endsWith('status')) {
        statusReads += 1
        if (statusReads === 1) return Promise.resolve([saved])
        return statusReads === 2 ? oldStatus.promise : freshStatus.promise
      }
      return removal.promise
    })
    render(
      <KvmSetup name="Different bot" initialId={saved.id} connected={vi.fn()} />
    )
    const remove = await screen.findByRole('button', {
      name: 'Remove owned computer',
    })
    await waitFor(() => expect(remove).toBeEnabled())
    act(() => events.update?.())
    expect(statusReads).toBe(2)
    fireEvent.click(remove)
    await act(async () => settleConfirm(true))
    expect(call).toHaveBeenCalledWith('setup/local-vm/remove', { id: saved.id })
    await act(async () => removal.resolve({ ...saved, stage: 'removed' }))
    await waitFor(() => expect(statusReads).toBe(3))
    await act(async () => freshStatus.resolve([]))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Check prerequisites again' })
      ).toBeEnabled()
    )
    expect(
      screen.queryByText('Saved local computer setups')
    ).not.toBeInTheDocument()
    await act(async () => {
      if (outcome === 'reply') oldStatus.resolve([saved])
      else oldStatus.reject(new Error('The old status request failed.'))
    })
    expect(
      screen.queryByText('Saved local computer setups')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove owned computer' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it.each(['reply', 'error'] as const)(
  'keeps the post-Resume setup state when an earlier event status returns a late %s',
  async (outcome) => {
    const saved = {
      id: 'writer-id',
      name: 'Writer',
      stage: 'connecting',
      issue: {
        code: 'guest_not_ready',
        message: 'The earlier guest connection was unavailable.',
        next_action: 'Resume setup for this computer.',
      },
    }
    const oldStatus = deferred<object[]>()
    const resume = deferred<object>()
    const freshStatus = deferred<object[]>()
    let statusReads = 0
    call.mockImplementation((path) => {
      if (path.endsWith('preflight'))
        return Promise.resolve({ ready: true, issues: [] })
      if (path.endsWith('status')) {
        statusReads += 1
        if (statusReads === 1) return Promise.resolve([saved])
        return statusReads === 2 ? oldStatus.promise : freshStatus.promise
      }
      return resume.promise
    })
    render(
      <KvmSetup name="Different bot" initialId={saved.id} connected={vi.fn()} />
    )
    const restart = await screen.findByRole('button', { name: 'Resume setup' })
    await waitFor(() => expect(restart).toBeEnabled())
    act(() => events.update?.())
    expect(statusReads).toBe(2)
    fireEvent.click(restart)
    expect(call).toHaveBeenCalledWith('setup/local-vm/start', {
      id: saved.id,
      name: saved.name,
    })
    await act(async () =>
      resume.resolve({ ...saved, stage: 'testing_desktop', issue: null })
    )
    await waitFor(() => expect(statusReads).toBe(3))
    await act(async () =>
      freshStatus.resolve([{ ...saved, stage: 'ready', issue: null }])
    )
    const use = await screen.findByRole('button', { name: 'Use this computer' })
    await waitFor(() => expect(use).toBeEnabled())
    expect(screen.getByText('Writer · Computer ready')).toBeInTheDocument()
    await act(async () => {
      if (outcome === 'reply') oldStatus.resolve([saved])
      else oldStatus.reject(new Error('The old status request failed.'))
    })
    expect(screen.getByText('Writer · Computer ready')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Use this computer' })
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Resume setup' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)
