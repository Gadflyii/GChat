import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AddEditMCPServer from '../dialogs/AddEditMCPServer'
import EditJsonMCPserver from '../dialogs/EditJsonMCPserver'

const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: translate }),
}))
vi.mock('@/components/JSONCodeEditor', () => ({
  default: ({ value, onChange }: {
    value: string
    onChange: React.ChangeEventHandler<HTMLTextAreaElement>
  }) => <textarea aria-label="MCP JSON" value={value} onChange={onChange} />,
}))

const config = { command: 'node', args: ['server.js'], env: {}, type: 'stdio' as const }

describe('MCP server configuration dialogs', () => {
  it('guides a web connection from provider details to a saved connection', async () => {
    const saved = new Map<string, unknown>()
    function Setup() {
      const [open, setOpen] = useState(true)
      return <AddEditMCPServer open={open} editingKey={null}
        onOpenChange={setOpen} onSave={async (connections) => {
          for (const [name, connection] of Object.entries(connections)) {
            saved.set(name, connection)
          }
        }} />
    }
    render(<Setup />)

    expect(screen.getByText(/Use the connection details supplied by the tool provider/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('mcp-servers:serverName'), {
      target: { value: 'My calendar' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Web address (HTTP)' }))
    fireEvent.change(screen.getByLabelText('Tool server address'), {
      target: { value: 'https://calendar.example/mcp' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(saved.get('My calendar')).toMatchObject({
      type: 'http',
      url: 'https://calendar.example/mcp',
    })
  })

  it('adds and removes rows with native, named keyboard buttons without saving', async () => {
    const user = userEvent.setup()
    const save = vi.fn()
    render(<AddEditMCPServer open editingKey="trusted" initialData={config}
      onOpenChange={vi.fn()} onSave={save} />)

    const rows = () => screen.getAllByRole('button', { name: 'Reorder command option' })
    expect(rows()[0].tagName).toBe('BUTTON')
    expect(rows()[0]).toHaveAttribute('type', 'button')
    const add = screen.getByRole('button', { name: 'Add command option' })
    add.focus()
    await user.keyboard('{Enter}')
    expect(rows()).toHaveLength(2)
    await user.tab()
    expect(rows()[0]).toHaveFocus()
    const remove = screen.getAllByRole('button', { name: 'Remove command option' })[0]
    remove.focus()
    await user.keyboard(' ')
    expect(rows()).toHaveLength(1)

    const addSetting = screen.getByRole('button', { name: 'Add extra setting' })
    addSetting.focus()
    await user.keyboard(' ')
    const removeSetting = screen.getAllByRole('button', { name: 'Remove extra setting' })[0]
    removeSetting.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('button', { name: 'Remove extra setting' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Web address (HTTP)' }))
    const addHeader = screen.getByRole('button', { name: 'Add header' })
    addHeader.focus()
    await user.keyboard('{Enter}')
    const removeHeader = screen.getAllByRole('button', { name: 'Remove header' })[0]
    removeHeader.focus()
    await user.keyboard(' ')
    expect(screen.queryByRole('button', { name: 'Remove header' })).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps keyboard focus on the moved command option and saves its new order', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    // JSDOM has no layout. Supply only the row geometry the real keyboard
    // sensor needs to move between the three visible command options.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const handle = this.getAttribute('aria-label') === 'Reorder command option'
          ? this
          : this.firstElementChild?.getAttribute('aria-label') === 'Reorder command option'
            ? this.firstElementChild
            : null
        if (!handle) return originalRect.call(this)
        const handles = screen.getAllByRole('button', { name: 'Reorder command option' })
        const top = 100 + handles.indexOf(handle as HTMLElement) * 50
        return {
          x: 0, y: top, top, bottom: top + 40, left: 0, right: 300,
          width: 300, height: 40, toJSON: () => ({}),
        }
      })
    try {
      render(<AddEditMCPServer open editingKey="trusted"
        initialData={{ ...config, args: ['alpha', 'beta', 'gamma'], active: false }}
        onOpenChange={vi.fn()} onSave={save} />)

      screen.getAllByRole('button', { name: 'Reorder command option' })[0].focus()
      await user.keyboard('[Space][ArrowDown][Space]')

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Reorder command option' })
          .map((handle) => handle.parentElement?.querySelector('input')?.value))
          .toEqual(['beta', 'alpha', 'gamma'])
      })
      expect(screen.getByDisplayValue('alpha').parentElement
        ?.querySelector('button[aria-label="Reorder command option"]')).toHaveFocus()
      expect(save).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'mcp-servers:save' }))
      await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({
        trusted: expect.objectContaining({ args: ['beta', 'alpha', 'gamma'], active: false }),
      }))
    } finally {
      rect.mockRestore()
    }
  })

  it('asks for the missing start command or web address in plain words without calling save', async () => {
    const save = vi.fn()
    render(<AddEditMCPServer open editingKey={null} onOpenChange={vi.fn()} onSave={save} />)
    fireEvent.change(screen.getByLabelText('mcp-servers:serverName'), { target: { value: 'Calendar' } })
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the start command from the tool provider')
    fireEvent.click(screen.getByRole('radio', { name: 'Web address (HTTP)' }))
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enter the web address from the tool provider'))
    expect(save).not.toHaveBeenCalled()
  })

  it('does not let a new connection silently replace one with the same name', async () => {
    const save = vi.fn()
    render(<AddEditMCPServer open editingKey={null} existingNames={['Exa']} onOpenChange={vi.fn()} onSave={save} />)
    fireEvent.change(screen.getByLabelText('mcp-servers:serverName'), { target: { value: 'Exa' } })
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A tool connection named “Exa” already exists')
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the form open with the native validation error when saving fails', async () => {
    const close = vi.fn()
    const save = vi.fn().mockRejectedValue(new Error('MCP header name is invalid'))
    render(<AddEditMCPServer open editingKey="trusted" initialData={config}
      onOpenChange={close} onSave={save} />)

    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('MCP header name is invalid')
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('trusted')).toBeInTheDocument()
  })

  it('submits a JSON batch once so native validation covers every server before mutation', async () => {
    const close = vi.fn()
    const save = vi.fn().mockRejectedValue(new Error('MCP args must be an array of strings'))
    render(<AddEditMCPServer open editingKey={null} onOpenChange={close} onSave={save} />)
    fireEvent.click(screen.getByTitle('Paste advanced settings (JSON)'))
    const batch = { first: config, invalid: { ...config, args: 1 } }
    fireEvent.change(screen.getByLabelText('MCP JSON'), {
      target: { value: JSON.stringify(batch) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('MCP args must be an array of strings')
    expect(save).toHaveBeenCalledExactlyOnceWith(batch)
    expect(close).not.toHaveBeenCalled()
  })

  it('preserves a JSON server whose name is also an object prototype key', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<AddEditMCPServer open editingKey={null} onOpenChange={vi.fn()} onSave={save} />)
    fireEvent.click(screen.getByTitle('Paste advanced settings (JSON)'))
    const batch = JSON.parse(`{"__proto__":${JSON.stringify(config)}}`)
    fireEvent.change(screen.getByLabelText('MCP JSON'), {
      target: { value: JSON.stringify(batch) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(JSON.parse(JSON.stringify(save.mock.calls[0][0]))).toEqual(batch)
    expect(Object.prototype.hasOwnProperty.call(save.mock.calls[0][0], '__proto__')).toBe(true)
  })

  it('removes HTTP fields when an existing server is changed to stdio', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<AddEditMCPServer open editingKey="trusted" onOpenChange={vi.fn()} onSave={save}
      initialData={{ ...config, type: 'http', url: 'http://localhost:3001/mcp', headers: { Authorization: 'Bearer token' } }} />)
    fireEvent.click(screen.getByRole('radio', { name: /STDIO/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:save' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const persisted = JSON.parse(JSON.stringify(save.mock.calls[0][0]))
    expect(persisted.trusted.type).toBe('stdio')
    expect(persisted.trusted).not.toHaveProperty('url')
    expect(persisted.trusted).not.toHaveProperty('headers')
  })

  it('waits for the JSON configuration to save before closing and prevents duplicate saves', async () => {
    const close = vi.fn()
    let finish!: () => void
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<EditJsonMCPserver open serverName="trusted" initialData={config}
      onOpenChange={close} onSave={save} />)
    const button = screen.getByRole('button', { name: 'mcp-servers:editJson.save' })

    fireEvent.click(button)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(save).toHaveBeenCalledExactlyOnceWith(config)
    expect(close).not.toHaveBeenCalled()

    await act(async () => { finish() })
    expect(close).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('shows a rejected JSON configuration without discarding the edited text', async () => {
    const close = vi.fn()
    const save = vi.fn().mockRejectedValue(new Error('MCP args must be an array of strings'))
    render(<EditJsonMCPserver open serverName="trusted" initialData={config}
      onOpenChange={close} onSave={save} />)
    const invalid = JSON.stringify({ ...config, args: 1 })
    fireEvent.change(screen.getByLabelText('MCP JSON'), { target: { value: invalid } })
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:editJson.save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('MCP args must be an array of strings')
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('MCP JSON')).toHaveValue(invalid)
    await waitFor(() => expect(screen.getByRole('button', { name: 'mcp-servers:editJson.save' })).toBeEnabled())
  })
})
