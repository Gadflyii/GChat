import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    fireEvent.click(screen.getByTitle('Add server by JSON'))
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
    fireEvent.click(screen.getByTitle('Add server by JSON'))
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
