import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WorkspacePicker } from '../WorkspacePicker'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/services/agent/tauri', () => ({
  resolveAgentWorkspaceRoot: async (path?: string) => ({
    path: path ?? '/default-workspace',
  }),
}))
it('shows the resolved default and allows opening it without typing a path', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined)
  render(<WorkspacePicker value="" onChange={vi.fn()} />)
  expect(await screen.findByText('/default-workspace')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
  expect(invoke).toHaveBeenCalledWith('open_file_explorer', {
    path: '/default-workspace',
  })
})
