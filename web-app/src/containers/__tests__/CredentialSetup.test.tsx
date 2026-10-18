import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialSetup } from '../CredentialSetup'

const command = vi.hoisted(() => vi.fn())
vi.mock('@/services/engines', () => ({ engineCommand: command }))
afterEach(cleanup)
beforeEach(() => {
  command.mockReset()
})
describe('secure storage intake', () => {
  it('reads only passive status on mount and checks the keyring after an explicit click', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: false,
      tier: 'native',
      state: 'unchecked',
    })
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    await screen.findByText(/Select the Check secure storage button below to confirm/)
    const setupPanel = screen.getByRole('region', {
      name: 'Secure storage setup',
    })
    expect(setupPanel).toHaveClass('rounded-xl', 'p-5')
    expect(command).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenCalledWith('credential_status', { check: false })
    expect(ready).not.toHaveBeenCalledWith(true)
    command.mockResolvedValue({
      ready: true,
      platform: 'linux',
      can_install: false,
      tier: 'native',
      state: 'ready',
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Check secure storage' })
    )
    await screen.findByText('Secure storage is ready.')
    expect(screen.getByRole('region', { name: 'Secure storage setup' })).toBe(
      setupPanel
    )
    expect(
      screen.getByRole('heading', { name: 'Secure storage' })
    ).toBeInTheDocument()
    expect(command).toHaveBeenLastCalledWith('credential_status', {
      check: true,
    })
    expect(ready).toHaveBeenLastCalledWith(true)
  })
  it('offers only the check before it has been run, so setup or installation is never the first step', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: true,
      tier: 'native',
      state: 'unchecked',
    })
    render(<CredentialSetup onReady={vi.fn()} />)
    await screen.findByText(/Select the Check secure storage button below to confirm/)
    expect(
      screen.getByRole('button', { name: 'Check secure storage' })
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Set up secure storage' })
    ).not.toBeInTheDocument()
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: true,
      tier: 'native',
      state: 'unavailable',
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Check secure storage' })
    )
    expect(
      await screen.findByRole('button', { name: 'Set up secure storage' })
    ).toBeInTheDocument()
  })
  it('uses an existing provider without offering installation', async () => {
    command.mockResolvedValue({
      ready: true,
      platform: 'linux',
      can_install: false,
    })
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    await screen.findByText('Secure storage is ready.')
    expect(
      screen.queryByRole('button', { name: 'Set up secure storage' })
    ).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(true)
    expect(command).toHaveBeenCalledTimes(1)
  })
  it('installs only after a click and rechecks instead of assuming success', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: true,
    })
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    await screen.findByRole('alert')
    expect(command).not.toHaveBeenCalledWith(
      'credential_install',
      expect.anything()
    )
    command.mockImplementation(async (action: string) =>
      action === 'credential_install'
        ? { installed: true }
        : { ready: true, platform: 'linux', can_install: false }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Set up secure storage' })
    )
    await screen.findByText('Secure storage is ready.')
    expect(command).toHaveBeenCalledWith('credential_install', {
      confirmed: true,
    })
    expect(command).toHaveBeenLastCalledWith('credential_status', {
      check: true,
    })
    expect(screen.getByText('Secure storage is ready.')).toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(true)
  })
  it('supports skip and manual unlock guidance without enabling pairing', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: false,
      error: 'locked',
    })
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(
      screen.getByText(/Local models remain available/)
    ).toBeInTheDocument()
    expect(ready).not.toHaveBeenCalledWith(true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Set up secure storage' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Set up secure storage' })
    )
    expect(
      screen.getByText(/On Linux, open your system software manager/)
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
  })
  it('keeps pairing unavailable after installation if the keyring still needs unlocking', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: true,
    })
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    await screen.findByRole('alert')
    fireEvent.click(
      screen.getByRole('button', { name: 'Set up secure storage' })
    )
    await screen.findByText(/Installation finished/)
    expect(
      screen.getByText(/Secure storage is unavailable/)
    ).toBeInTheDocument()
    await waitFor(() => expect(command).toHaveBeenCalledTimes(3))
    expect(ready).not.toHaveBeenCalledWith(true)
  })
  it('shows an installation cancellation and permits retry', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: true,
    })
    render(<CredentialSetup />)
    await screen.findByRole('alert')
    command.mockRejectedValueOnce(new Error('Administrator approval cancelled'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Set up secure storage' })
    )
    await screen.findByText(/Administrator approval cancelled/)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
  })
  it('creates a vault only after explicit matching-passphrase confirmation', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: false,
      can_create: true,
      state: 'missing_provider',
    })
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use a passphrase vault' })
    )
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'test passphrase' },
    })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'different' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create passphrase vault' })
    )
    await screen.findByText('The passphrases do not match.')
    expect(command).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'test passphrase' },
    })
    command.mockResolvedValue({
      ready: true,
      platform: 'linux',
      tier: 'passphrase',
      can_install: false,
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create passphrase vault' })
    )
    await screen.findByRole('button', { name: 'Lock vault' })
    expect(command).toHaveBeenLastCalledWith('credential_create', {
      confirmed: true,
      passphrase: 'test passphrase',
    })
    expect(ready).toHaveBeenLastCalledWith(true)
  })
  it('clears discarded vault errors and secret drafts when creation is canceled', async () => {
    command.mockResolvedValue({
      ready: true,
      platform: 'linux',
      can_install: false,
      tier: 'native',
      state: 'ready',
    })
    render(<CredentialSetup />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use a passphrase vault' })
    )
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'test passphrase' },
    })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'different' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create passphrase vault' })
    )
    await screen.findByText('The passphrases do not match.')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Secure storage is ready.')).toBeInTheDocument()
    expect(
      screen.queryByText('The passphrases do not match.')
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
    expect(command).toHaveBeenCalledTimes(1)

    fireEvent.click(
      screen.getByRole('button', { name: 'Use a passphrase vault' })
    )
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    expect(screen.getByLabelText('Confirm passphrase')).toHaveValue('')
    expect(command).toHaveBeenCalledTimes(1)
  })
  it('keeps a selected locked provider and clears a rejected vault passphrase', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: false,
      tier: 'native',
      state: 'locked',
    })
    const view = render(<CredentialSetup />)
    await screen.findByRole('alert')
    expect(
      screen.queryByRole('button', { name: 'Use a passphrase vault' })
    ).not.toBeInTheDocument()
    view.unmount()
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: false,
      tier: 'passphrase',
      state: 'locked',
    })
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock vault' }))
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'wrong passphrase' },
    })
    command.mockRejectedValueOnce(new Error('The passphrase is incorrect'))
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))
    await screen.findByText('Error: The passphrase is incorrect')
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    expect(ready).not.toHaveBeenCalledWith(true)
    expect(
      screen.queryByRole('button', { name: 'Use a passphrase vault' })
    ).not.toBeInTheDocument()
  })
  it('resumes a migration without creating another vault and locks an unlocked vault', async () => {
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: false,
      migrating: true,
      tier: 'native',
    })
    render(<CredentialSetup />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Resume migration' })
    )
    expect(
      screen.queryByLabelText('Confirm passphrase')
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'existing passphrase' },
    })
    command.mockResolvedValue({
      ready: true,
      platform: 'linux',
      tier: 'passphrase',
      can_install: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resume migration' }))
    await screen.findByRole('button', { name: 'Lock vault' })
    expect(command).toHaveBeenLastCalledWith('credential_create', {
      confirmed: true,
      passphrase: 'existing passphrase',
    })
    command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      tier: 'passphrase',
      state: 'locked',
      can_install: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    await screen.findByRole('button', { name: 'Unlock vault' })
    expect(command).toHaveBeenLastCalledWith('credential_lock', {})
  })
})

describe('Lock vault feedback', () => {
  const unlocked = {
    ready: true,
    platform: 'linux',
    can_install: false,
    tier: 'passphrase',
    state: 'ready',
  }
  const locked = { ...unlocked, ready: false, state: 'locked' }
  const confirmLockMessage =
    'Could not finish locking the vault. Choose Check again to confirm whether the vault is locked before continuing.'

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  it('names a pending Lock, removes stale readiness and prevents duplicate locking', async () => {
    const lock = deferred<typeof locked>()
    command.mockResolvedValueOnce(unlocked).mockReturnValueOnce(lock.promise)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    const lockButton = await screen.findByRole('button', { name: 'Lock vault' })
    expect(ready).toHaveBeenLastCalledWith(true)

    fireEvent.click(lockButton)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Locking the passphrase vault…'
    )
    expect(screen.queryByText('Secure storage is ready.')).not.toBeInTheDocument()
    expect(screen.queryByText(/You can continue setup/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock vault' })).toBeDisabled()
    expect(ready).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    expect(command).toHaveBeenCalledTimes(2)
    expect(command).toHaveBeenLastCalledWith('credential_lock', {})

    await act(async () => {
      lock.resolve(locked)
    })
    expect(
      await screen.findByRole('button', { name: 'Unlock vault' })
    ).toBeEnabled()
    expect(
      screen.queryByText(/Locking the passphrase vault/)
    ).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(false)
  })

  it('keeps rejected Lock pending through its status read, then explains an unlocked result and permits one deliberate retry', async () => {
    const statusRead = deferred<typeof unlocked>()
    const retryLock = deferred<typeof locked>()
    const nativeError = 'Native Lock cleanup failed after closing account access'
    command
      .mockResolvedValueOnce(unlocked)
      .mockRejectedValueOnce(new Error(nativeError))
      .mockReturnValueOnce(statusRead.promise)
      .mockReturnValueOnce(retryLock.promise)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lock vault' }))

    await waitFor(() => expect(command).toHaveBeenCalledTimes(3))
    expect(command).toHaveBeenLastCalledWith('credential_status', { check: false })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Locking the passphrase vault…'
    )
    expect(screen.queryByText('Secure storage is ready.')).not.toBeInTheDocument()
    expect(screen.queryByText(/You can continue setup/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock vault' })).toBeDisabled()
    expect(screen.queryByText(new RegExp(nativeError))).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(false)

    await act(async () => {
      statusRead.resolve(unlocked)
    })
    expect(
      await screen.findByText(
        'Could not finish locking the vault. The vault is currently unlocked. Choose Lock vault to try again.'
      )
    ).toBeVisible()
    const errorDetails = screen.getByText('Lock error details').closest('details')!
    expect(errorDetails).not.toHaveAttribute('open')
    expect(errorDetails).toHaveTextContent(nativeError)
    expect(screen.getByText(new RegExp(nativeError))).not.toBeVisible()

    const retry = screen.getByRole('button', { name: 'Lock vault' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(command).toHaveBeenCalledTimes(4)
    expect(command).toHaveBeenLastCalledWith('credential_lock', {})
    expect(ready).toHaveBeenLastCalledWith(false)
    await act(async () => {
      retryLock.resolve(locked)
    })
    expect(
      await screen.findByRole('button', { name: 'Unlock vault' })
    ).toBeEnabled()
    expect(
      screen.queryByText(/Could not finish locking the vault/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Lock error details')).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(false)
  })

  it('does not claim a rejected Lock left the vault unlocked when the fresh status is locked', async () => {
    const nativeError = 'Native Lock reported an error after locking credentials'
    command
      .mockResolvedValueOnce(unlocked)
      .mockRejectedValueOnce(new Error(nativeError))
      .mockResolvedValueOnce(locked)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lock vault' }))

    expect(await screen.findByText(confirmLockMessage)).toBeVisible()
    expect(
      screen.queryByText(/The vault is currently unlocked/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Secure storage is ready.')).not.toBeInTheDocument()
    expect(screen.queryByText(/You can continue setup/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
    const errorDetails = screen.getByText('Lock error details').closest('details')!
    expect(errorDetails).not.toHaveAttribute('open')
    expect(errorDetails).toHaveTextContent(nativeError)
    expect(screen.getByText(new RegExp(nativeError))).not.toBeVisible()
    expect(ready).toHaveBeenLastCalledWith(false)
    expect(command).toHaveBeenCalledTimes(3)
    expect(command).toHaveBeenLastCalledWith('credential_status', { check: false })
  })

  it('recovers an unknown Lock outcome with an explicit read-only Check without replaying Lock', async () => {
    const recovery = deferred<typeof locked>()
    const nativeError = 'Native Lock could not finish clearing connection state'
    command
      .mockResolvedValueOnce(unlocked)
      .mockRejectedValueOnce(new Error(nativeError))
      .mockRejectedValueOnce(new Error('Passive vault status is unavailable'))
      .mockReturnValueOnce(recovery.promise)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lock vault' }))

    expect(await screen.findByText(confirmLockMessage)).toBeVisible()
    expect(
      screen.queryByText(/The vault is currently unlocked/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Secure storage is ready.')).not.toBeInTheDocument()
    expect(screen.queryByText(/You can continue setup/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Lock vault' })
    ).not.toBeInTheDocument()
    const errorDetails = screen.getByText('Lock error details').closest('details')!
    expect(errorDetails).not.toHaveAttribute('open')
    expect(screen.getByText(new RegExp(nativeError))).not.toBeVisible()
    expect(ready).toHaveBeenLastCalledWith(false)

    const check = screen.getByRole('button', { name: 'Check again' })
    fireEvent.click(check)
    expect(check).toBeDisabled()
    expect(command).toHaveBeenCalledTimes(4)
    expect(command).toHaveBeenLastCalledWith('credential_status', { check: true })
    expect(
      command.mock.calls.filter(([action]) => action === 'credential_lock')
    ).toHaveLength(1)
    await act(async () => {
      recovery.resolve(locked)
    })
    expect(
      await screen.findByRole('button', { name: 'Unlock vault' })
    ).toBeEnabled()
    expect(screen.queryByText(confirmLockMessage)).not.toBeInTheDocument()
    expect(screen.queryByText('Lock error details')).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(false)
    expect(command).toHaveBeenCalledTimes(4)
  })
})

describe('Passphrase vault error guidance', () => {
  const locked = {
    ready: false,
    platform: 'linux',
    can_install: false,
    tier: 'passphrase',
    state: 'locked',
  }
  const unlocked = { ...locked, ready: true, state: 'ready' }
  const canCreate = {
    ready: false,
    platform: 'linux',
    can_install: false,
    can_create: true,
    state: 'missing_provider',
  }

  function expectClosedError(nativeError: string) {
    const details = screen.getByText('Vault error details').closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent(nativeError)
    expect(screen.getByText(new RegExp(nativeError))).not.toBeVisible()
  }

  it('explains a rejected Unlock, clears the secret and allows one explicit retry from a fresh locked status', async () => {
    const nativeError = 'The passphrase is incorrect or the vault is damaged'
    command
      .mockResolvedValueOnce(locked)
      .mockRejectedValueOnce(new Error(nativeError))
      .mockResolvedValueOnce(locked)
      .mockResolvedValueOnce(unlocked)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock vault' }))
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'first passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))

    expect(
      await screen.findByText('Could not finish unlocking the vault.')
    ).toBeVisible()
    expect(screen.getByText(/The vault is currently locked/)).toBeVisible()
    expectClosedError(nativeError)
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    expect(screen.getByLabelText('Passphrase')).toHaveAttribute(
      'autocomplete',
      'current-password'
    )
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
    expect(ready).not.toHaveBeenCalledWith(true)
    expect(command).toHaveBeenCalledTimes(3)
    expect(command).toHaveBeenLastCalledWith('credential_status', { check: false })

    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'retry passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))
    expect(await screen.findByRole('button', { name: 'Lock vault' })).toBeEnabled()
    expect(command).toHaveBeenCalledTimes(4)
    expect(command).toHaveBeenLastCalledWith('credential_unlock', {
      passphrase: 'retry passphrase',
    })
    expect(screen.queryByText('Vault error details')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(true)
  })

  it('clears both Create fields and explains how to retry when fresh status still permits creation', async () => {
    const nativeError = 'The vault file could not be written'
    command
      .mockResolvedValueOnce(canCreate)
      .mockRejectedValueOnce(new Error(nativeError))
      .mockResolvedValueOnce(canCreate)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use a passphrase vault' })
    )
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'new passphrase' },
    })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'new passphrase' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create passphrase vault' })
    )

    expect(
      await screen.findByText('Could not finish creating the passphrase vault.')
    ).toBeVisible()
    expect(screen.getByText(/Enter and confirm your passphrase/)).toBeVisible()
    expectClosedError(nativeError)
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    expect(screen.getByLabelText('Confirm passphrase')).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Create passphrase vault' })
    ).toBeEnabled()
    expect(command).toHaveBeenCalledTimes(3)
    expect(command).toHaveBeenLastCalledWith('credential_status', { check: false })
    expect(ready).not.toHaveBeenCalledWith(true)
  })

  it('keeps an interrupted migration on Resume with the existing passphrase even when fresh status is ready', async () => {
    const migrating = {
      ...unlocked,
      tier: 'native',
      migrating: true,
    }
    const nativeError = 'The connection copy could not be verified'
    command
      .mockResolvedValueOnce({ ...migrating, ready: false })
      .mockRejectedValueOnce(new Error(nativeError))
      .mockResolvedValueOnce(migrating)
    render(<CredentialSetup />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Resume migration' })
    )
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'existing passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resume migration' }))

    expect(
      await screen.findByText('Could not finish resuming the vault migration.')
    ).toBeVisible()
    expect(
      screen.getByText(/Your saved connections are still being moved/)
    ).toBeVisible()
    expectClosedError(nativeError)
    expect(screen.getByRole('button', { name: 'Resume migration' })).toBeEnabled()
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    expect(screen.getByLabelText('Passphrase')).toHaveAttribute(
      'autocomplete',
      'current-password'
    )
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create passphrase vault' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Secure storage is ready.')).not.toBeInTheDocument()
    expect(command).toHaveBeenCalledWith('credential_create', {
      confirmed: true,
      passphrase: 'existing passphrase',
    })
    expect(command).toHaveBeenCalledTimes(3)
  })

  it('closes Create after a rejected operation leaves an unlocked vault while retaining its warning', async () => {
    const nativeError = 'Gbot could not unlock its saved connections'
    command
      .mockResolvedValueOnce(canCreate)
      .mockRejectedValueOnce(new Error(nativeError))
      .mockResolvedValueOnce(unlocked)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use a passphrase vault' })
    )
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'new passphrase' },
    })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'new passphrase' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create passphrase vault' })
    )

    expect(
      await screen.findByText('Could not finish creating the passphrase vault.')
    ).toBeVisible()
    expect(screen.getByText(/The vault is currently unlocked/)).toBeVisible()
    expect(
      screen.getByText(/If Gbot still cannot use your saved connections/)
    ).toBeVisible()
    expectClosedError(nativeError)
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create passphrase vault' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock vault' })).toBeEnabled()
    expect(ready).toHaveBeenLastCalledWith(true)
    expect(command).toHaveBeenCalledTimes(3)
  })

  it.each(['unavailable status', 'failed status read'])(
    'requires a read-only Check after an unknown Unlock outcome from %s',
    async (outcome) => {
      const nativeError = 'Gbot did not confirm that its vault was unlocked'
      command
        .mockResolvedValueOnce(locked)
        .mockRejectedValueOnce(new Error(nativeError))
      if (outcome === 'unavailable status')
        command.mockResolvedValueOnce({
          ...locked,
          state: 'unavailable',
          error: 'The vault is busy finishing an earlier request',
        })
      else command.mockRejectedValueOnce(new Error('The status read timed out'))
      command.mockResolvedValueOnce(locked)
      const ready = vi.fn()
      render(<CredentialSetup onReady={ready} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Unlock vault' }))
      fireEvent.change(screen.getByLabelText('Passphrase'), {
        target: { value: 'existing passphrase' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))

      expect(
        await screen.findByText(
          /The vault’s current state could not be confirmed/
        )
      ).toBeVisible()
      expectClosedError(nativeError)
      expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Unlock vault' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Create passphrase vault' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/The vault is currently locked/)
      ).not.toBeInTheDocument()
      expect(ready).not.toHaveBeenCalledWith(true)
      expect(command).toHaveBeenCalledTimes(3)

      fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
      expect(
        await screen.findByRole('button', { name: 'Unlock vault' })
      ).toBeEnabled()
      expect(screen.getByLabelText('Passphrase')).toHaveValue('')
      expect(command).toHaveBeenCalledTimes(4)
      expect(command).toHaveBeenLastCalledWith('credential_status', { check: true })
      expect(
        command.mock.calls.filter(([action]) => action === 'credential_unlock')
      ).toHaveLength(1)
      expect(ready).not.toHaveBeenCalledWith(true)
    }
  )

  it('switches from Create to Unlock when a rejected creation has already left a locked vault', async () => {
    const nativeError = 'Gbot did not accept the newly created vault'
    command
      .mockResolvedValueOnce(canCreate)
      .mockRejectedValueOnce(new Error(nativeError))
      .mockResolvedValueOnce(locked)
    const ready = vi.fn()
    render(<CredentialSetup onReady={ready} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use a passphrase vault' })
    )
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'new passphrase' },
    })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'new passphrase' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create passphrase vault' })
    )

    expect(
      await screen.findByText('Could not finish creating the passphrase vault.')
    ).toBeVisible()
    expect(screen.getByText(/The vault is currently locked/)).toBeVisible()
    expectClosedError(nativeError)
    expect(screen.getByRole('button', { name: 'Unlock vault' })).toBeEnabled()
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    expect(screen.getByLabelText('Passphrase')).toHaveAttribute(
      'autocomplete',
      'current-password'
    )
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create passphrase vault' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Use a passphrase vault' })
    ).not.toBeInTheDocument()
    expect(command).toHaveBeenCalledTimes(3)
    expect(command).toHaveBeenLastCalledWith('credential_status', { check: false })
    expect(ready).not.toHaveBeenCalledWith(true)
  })
})
