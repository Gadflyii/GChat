import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineHostName } from '@/containers/EngineHostName'

const mocks = vi.hoisted(() => ({ command: vi.fn().mockResolvedValue({}), refresh: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/services/engines', () => ({ engineCommand: mocks.command }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: () => ({
  hosts: [{ host_id: 'local', local: true, name: 'WORKSTATION' }], errors: {},
  snapshots: { local: { display_name: 'WORKSTATION', lan_sharing: { managed: true } } }, refresh: mocks.refresh,
}) }))
afterEach(cleanup)

it('edits the local host name in settings and refreshes the host registry', async () => {
  render(<EngineHostName />)
  expect(screen.getByLabelText('Host name')).toHaveValue('WORKSTATION')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Host name'), { target: { value: '  Lab desktop  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('host_name', { host_id: 'local', body: { name: 'Lab desktop' } }))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
})
