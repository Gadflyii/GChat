import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  importGoogleDesktopRegistration,
  type ConnectorAccountsView,
} from '../workspace-connectors'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const view: ConnectorAccountsView = {
  configs: [],
  accounts: [],
  active_flows: [],
  selected_accounts: {},
  services: { google: [], microsoft: [] },
}
const desktopFile = (registration: unknown) =>
  new File([JSON.stringify(registration)], 'desktop.json', {
    type: 'application/json',
  })
const invalidMessage =
  'Choose the downloaded Google Desktop app JSON file, no larger than 64 KB.'

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(view)
})
afterEach(() => vi.restoreAllMocks())

describe('Google Desktop registration import', () => {
  it('forwards only the Desktop client credentials to native configuration', async () => {
    const result = await importGoogleDesktopRegistration(
      desktopFile({
        installed: {
          client_id: ' downloaded.apps.googleusercontent.com ',
          client_secret: 'desktop-secret',
          auth_uri: 'https://untrusted.example/authorize',
          token_uri: 'https://untrusted.example/token',
          redirect_uris: ['https://untrusted.example/callback'],
        },
      })
    )

    expect(invoke).toHaveBeenCalledExactlyOnceWith('connector_configure', {
      request: {
        provider: 'google',
        client_id: 'downloaded.apps.googleusercontent.com',
        client_secret: 'desktop-secret',
      },
    })
    expect(result).toBe(view)
    expect(result).not.toHaveProperty('client_secret')
  })

  it.each([undefined, ''])(
    'explicitly clears the old vault secret for %s',
    async (secret) => {
      await importGoogleDesktopRegistration(
        desktopFile({
          installed: { client_id: 'new-client', client_secret: secret },
        })
      )

      expect(invoke).toHaveBeenCalledExactlyOnceWith('connector_configure', {
        request: {
          provider: 'google',
          client_id: 'new-client',
          client_secret: '',
        },
      })
    }
  )

  it.each([
    null,
    [],
    { web: { client_id: 'web-client', client_secret: 'private-secret' } },
    { type: 'service_account', private_key: 'private-secret' },
    { installed: [] },
    { installed: 'private-secret' },
    { installed: { client_id: ' ' } },
    { installed: { client_id: 123 } },
    { installed: { client_id: 'client', client_secret: null } },
    { installed: { client_id: 'client', client_secret: 123 } },
    { installed: { client_id: 'x'.repeat(4097) } },
    { installed: { client_id: 'client', client_secret: 'x'.repeat(4097) } },
    { installed: { client_id: 'client' }, web: { client_id: 'web-client' } },
  ])(
    'rejects invalid or non-Desktop registration %# without invoking native',
    async (contents) => {
      await expect(
        importGoogleDesktopRegistration(desktopFile(contents))
      ).rejects.toThrow(invalidMessage)
      expect(invoke).not.toHaveBeenCalled()
    }
  )

  it('rejects malformed JSON without exposing its contents', async () => {
    await expect(
      importGoogleDesktopRegistration(
        new File(['private-secret: invalid JSON'], 'desktop.json')
      )
    ).rejects.toThrow(invalidMessage)
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([0, 64 * 1024 + 1])(
    'rejects a %i-byte file before reading it',
    async (size) => {
      const read = vi.spyOn(FileReader.prototype, 'readAsText')
      await expect(
        importGoogleDesktopRegistration(
          new File([' '.repeat(size)], 'desktop.json')
        )
      ).rejects.toThrow(invalidMessage)
      expect(read).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
    }
  )

  it('accepts a valid file at the 64 KB boundary', async () => {
    const contents = JSON.stringify({
      installed: { client_id: 'boundary-client' },
    })
    await importGoogleDesktopRegistration(
      new File([contents.padEnd(64 * 1024, ' ')], 'desktop.json')
    )
    expect(invoke).toHaveBeenCalledExactlyOnceWith('connector_configure', {
      request: {
        provider: 'google',
        client_id: 'boundary-client',
        client_secret: '',
      },
    })
  })

  it('reports file read failure with a generic message', async () => {
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(
      function (this: FileReader) {
        this.dispatchEvent(new ProgressEvent('error'))
      }
    )
    await expect(
      importGoogleDesktopRegistration(
        desktopFile({ installed: { client_id: 'client' } })
      )
    ).rejects.toThrow(invalidMessage)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not return native error details or credentials when vault saving fails', async () => {
    invoke.mockRejectedValue(new Error('private-native-secret'))
    await expect(
      importGoogleDesktopRegistration(
        desktopFile({ installed: { client_id: 'client', client_secret: 'secret' } })
      )
    ).rejects.toThrow(
      'Could not save the Google registration. Try importing the Desktop app JSON again.'
    )
    expect(invoke).toHaveBeenCalledExactlyOnceWith('connector_configure', {
      request: { provider: 'google', client_id: 'client', client_secret: 'secret' },
    })
  })
})
