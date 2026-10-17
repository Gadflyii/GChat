import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { Route } from '../https-proxy'

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <nav>Settings</nav>,
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

const savedValues = {
  proxyEnabled: false,
  proxyUrl: 'http://saved-proxy.example.test:8080',
  proxyUsername: 'saved-user',
  proxyPassword: 'saved-password',
  proxyIgnoreSSL: false,
  verifyProxySSL: false,
  verifyProxyHostSSL: true,
  verifyPeerSSL: false,
  verifyHostSSL: true,
  noProxy: 'localhost,127.0.0.1,.local',
}

function renderSettings() {
  const Page = Route.component as ComponentType
  return render(
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      <Page />
    </TranslationContext.Provider>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useProxyConfig.setState(savedValues)
})

describe('Proxy settings', () => {
  it('associates visible field labels and novice guidance with the named controls', () => {
    renderSettings()

    const address = screen.getByRole('textbox', {
      name: 'Proxy server address',
    })
    const username = screen.getByRole('textbox', { name: 'Username' })
    const password = screen.getByLabelText('Password', { selector: 'input' })
    const bypass = screen.getByRole('textbox', {
      name: 'Connect directly to these addresses',
    })
    const enable = screen.getByRole('switch', { name: 'Use a network proxy' })
    const ignoreSSL = screen.getByRole('switch', {
      name: 'Skip certificate checks',
    })

    for (const [field, label] of [
      [address, 'Proxy server address'],
      [username, 'Username'],
      [password, 'Password'],
      [bypass, 'Connect directly to these addresses'],
    ] as const) {
      const labels = (field as HTMLInputElement).labels
      expect(labels).toHaveLength(1)
      expect(labels?.[0]).toBeVisible()
      expect(labels?.[0]).toHaveTextContent(label)
    }

    const addressHelp =
      'Leave the proxy off unless your network requires one. Ask your network administrator for the address and port, then enter both here.'
    const signInHelp =
      'Enter the username and password supplied for your proxy. Leave these empty if it does not require sign-in.'
    const bypassHelp =
      'These addresses bypass the proxy. Separate them with commas; keep localhost and 127.0.0.1 for services on this computer.'
    const certificateHelp =
      'Allow connections whose security certificate cannot be verified. Leave this off unless your network administrator requires it for a trusted proxy.'

    for (const help of [addressHelp, signInHelp, bypassHelp, certificateHelp]) {
      expect(screen.getByText(help)).toBeVisible()
    }
    expect(address).toHaveAccessibleDescription(addressHelp)
    expect(enable).toHaveAccessibleDescription(addressHelp)
    expect(username).toHaveAccessibleDescription(signInHelp)
    expect(password).toHaveAccessibleDescription(signInHelp)
    expect(bypass).toHaveAccessibleDescription(bypassHelp)
    expect(ignoreSSL).toHaveAccessibleDescription(certificateHelp)
    expect(enable).not.toBeChecked()
    expect(ignoreSSL).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Show proxy password' })
    ).toBeEnabled()
  })

  it('edits and clears exact field values while the proxy is off', async () => {
    const user = userEvent.setup()
    renderSettings()
    const expected = { ...savedValues }

    for (const { name, key, value } of [
      {
        name: 'Proxy server address',
        key: 'proxyUrl',
        value: 'socks5://proxy.example.test:1080',
      },
      { name: 'Username', key: 'proxyUsername', value: 'team user' },
      { name: 'Password', key: 'proxyPassword', value: ' p@ss w0rd! ' },
      {
        name: 'Connect directly to these addresses',
        key: 'noProxy',
        value: 'localhost,127.0.0.1, .internal',
      },
    ] as const) {
      const field = screen.getByLabelText(name, { selector: 'input' })
      expect(field).toBeEnabled()
      expect(field).toHaveValue(expected[key])

      await user.clear(field)
      expected[key] = ''
      expect(field).toHaveValue('')
      expect(useProxyConfig.getState()).toMatchObject(expected)

      await user.type(field, value)
      expected[key] = value
      expect(field).toHaveValue(value)
      expect(useProxyConfig.getState()).toMatchObject(expected)
    }
  })

  it('toggles proxy use and certificate checks independently without clearing saved values', async () => {
    const user = userEvent.setup()
    renderSettings()
    const enable = screen.getByRole('switch', { name: 'Use a network proxy' })
    const ignoreSSL = screen.getByRole('switch', {
      name: 'Skip certificate checks',
    })

    await user.click(enable)
    expect(enable).toBeChecked()
    expect(ignoreSSL).not.toBeChecked()
    expect(useProxyConfig.getState()).toMatchObject({
      ...savedValues,
      proxyEnabled: true,
    })

    await user.click(ignoreSSL)
    expect(enable).toBeChecked()
    expect(ignoreSSL).toBeChecked()
    expect(useProxyConfig.getState()).toMatchObject({
      ...savedValues,
      proxyEnabled: true,
      proxyIgnoreSSL: true,
    })

    await user.click(enable)
    expect(enable).not.toBeChecked()
    expect(ignoreSSL).toBeChecked()
    expect(useProxyConfig.getState()).toMatchObject({
      ...savedValues,
      proxyIgnoreSSL: true,
    })

    await user.click(ignoreSSL)
    expect(enable).not.toBeChecked()
    expect(ignoreSSL).not.toBeChecked()
    expect(useProxyConfig.getState()).toMatchObject(savedValues)
  })

  it('shows and hides the same password with the keyboard while retaining focus and saved values', async () => {
    const user = userEvent.setup()
    renderSettings()
    const password = screen.getByLabelText('Password', { selector: 'input' })
    const show = screen.getByRole('button', { name: 'Show proxy password' })
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveValue(savedValues.proxyPassword)
    expect(password.id).not.toBe('')
    expect(show).toHaveAttribute('aria-controls', password.id)

    await user.click(password)
    await user.tab()
    expect(show).toHaveFocus()
    await user.keyboard('{Enter}')

    const hide = screen.getByRole('button', { name: 'Hide proxy password' })
    expect(hide).toHaveFocus()
    expect(hide).toHaveAttribute('aria-controls', password.id)
    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue(savedValues.proxyPassword)
    expect(useProxyConfig.getState()).toMatchObject(savedValues)

    await user.keyboard(' ')
    expect(
      screen.getByRole('button', { name: 'Show proxy password' })
    ).toHaveFocus()
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveValue(savedValues.proxyPassword)
    expect(useProxyConfig.getState()).toMatchObject(savedValues)
  })
})
