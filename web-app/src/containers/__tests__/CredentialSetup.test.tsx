import {
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
beforeEach(() => command.mockReset())
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
    await screen.findByText(/Choose Check secure storage to confirm/)
    const setupPanel = screen.getByRole('region', {
      name: 'Secure storage setup',
    })
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
