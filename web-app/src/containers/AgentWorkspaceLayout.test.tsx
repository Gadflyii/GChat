import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AgentWorkspaceLayout } from './AgentWorkspaceLayout'
import { useArtifactStore } from '@/stores/artifact-store'
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store'

const media = vi.hoisted(() => ({ desktop: true }))
const panelLayouts = vi.hoisted(() => ({ values: [] as number[][] }))
const artifactPreview = vi.hoisted(() => ({ command: vi.fn() }))
const workspace = vi.hoisted(() => ({
  entries: [{ name: 'output.txt', path: 'output.txt', kind: 'file' }],
  list: vi.fn(),
}))
const agentWorkspace = {
  primaryRoot: {
    rootId: 'primary',
    path: '/workspace',
    name: 'workspace',
    canEdit: true,
  },
  externalRoots: [],
}
const onAddExternal = vi.fn()

vi.mock('@/hooks/useMediaQuery', () => ({
  useDesktopScreen: () => media.desktop,
}))

vi.mock('@/services/agent/tauri', () => ({
  listAgentWorkspace: workspace.list,
}))

vi.mock('@/lib/codeHighlighter', () => ({
  codeToHtml: async (code: string) => {
    const content = document.createElement('code')
    content.textContent = code
    return `<pre>${content.outerHTML}</pre>`
  },
}))

vi.mock('react-resizable-panels', () => ({
  PanelGroup: forwardRef(({ children }: { children: ReactNode }, ref) => {
    useImperativeHandle(ref, () => ({
      getId: () => 'agent-workspace',
      getLayout: () => panelLayouts.values.at(-1) ?? [],
      setLayout: (layout: number[]) => panelLayouts.values.push(layout),
    }))
    return <>{children}</>
  }),
  Panel: ({
    children,
    id,
    defaultSize,
  }: {
    children: ReactNode
    id: string
    defaultSize: number
  }) => (
    <div data-testid={`panel-${id}`} data-default-size={defaultSize}>
      {children}
    </div>
  ),
  PanelResizeHandle: () => <div />,
}))

vi.mock('./AgentWorkspaceFiles', () => ({
  AgentWorkspaceFiles: ({ onClose }: { onClose: () => void }) => (
    <div>
      Files
      <button type="button" onClick={onClose}>
        Close files sidebar
      </button>
    </div>
  ),
}))

vi.mock('./ArtifactPanel', () => ({
  ArtifactPanel: () => <div>Artifact panel</div>,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('AgentWorkspaceLayout', () => {
  beforeEach(() => {
    artifactPreview.command.mockReset().mockImplementation((command: string) => {
      if (command === 'set_artifact_html' || command === 'clear_artifact_html') {
        return
      }
      throw new Error(`Unexpected artifact preview command: ${command}`)
    })
    mockIPC(artifactPreview.command)
    media.desktop = true
    panelLayouts.values = []
    workspace.entries = [
      { name: 'output.txt', path: 'output.txt', kind: 'file' },
    ]
    workspace.list.mockReset().mockImplementation(async () => workspace.entries)
    useArtifactStore.getState().close()
    useWorkspacePreviewStore.getState().reset()
  })

  it('shares the workspace layout across desktop conversations', async () => {
    const agentLayout = render(
      <AgentWorkspaceLayout
        threadId="agent"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Agent chat</div>
      </AgentWorkspaceLayout>
    )
    expect(await screen.findByText('Files')).toBeInTheDocument()
    expect(screen.getByTestId('panel-agent-preview')).toBeInTheDocument()
    expect(screen.queryByText('Artifact panel')).not.toBeInTheDocument()
    expect(screen.getByText('Agent chat').parentElement).toHaveClass(
      'flex',
      'h-full'
    )
    agentLayout.unmount()

    const chatLayout = render(
      <AgentWorkspaceLayout
        threadId="chat"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )
    expect(await screen.findByText('Files')).toBeInTheDocument()
    expect(screen.queryByText('Artifact panel')).not.toBeInTheDocument()
    chatLayout.unmount()

    media.desktop = false
    render(
      <AgentWorkspaceLayout
        threadId="narrow"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Narrow Agent chat</div>
      </AgentWorkspaceLayout>
    )
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.getByText('Artifact panel')).toBeInTheDocument()
  })

  it('projects an opened HTML artifact into the shared preview tabs', async () => {
    render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )

    act(() => {
      useArtifactStore.getState().open('source', '<h1>Artifact</h1>')
    })

    await waitFor(() => {
      expect(useWorkspacePreviewStore.getState().tabs).toEqual([
        { id: 'artifact', kind: 'artifact', name: 'HTML' },
      ])
      expect(artifactPreview.command).toHaveBeenCalledWith('set_artifact_html', {
        id: expect.any(String),
        html: expect.stringContaining('<h1>Artifact</h1>'),
      })
      expect(screen.getByTitle('HTML preview')).toHaveAttribute(
        'src',
        expect.stringMatching(
          /^(artifact:\/\/localhost|http:\/\/artifact\.localhost)\/[^?]+\?v=1$/
        )
      )
    })
  })

  it('holds the preview until generation finishes', async () => {
    const { container } = render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
        isGenerating
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )

    act(() => {
      useArtifactStore.getState().open('source', '<h1>Artifact</h1>')
    })

    expect(
      await screen.findByText('chat:workspacePreview.generating')
    ).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('closes and reopens the files sidebar', async () => {
    render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Close files sidebar' })
    )
    await waitFor(() => {
      expect(screen.queryByText('Files')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open files sidebar' }))
    expect(await screen.findByText('Files')).toBeInTheDocument()
  })

  it('opens Files when initial primary-folder discovery fails', async () => {
    workspace.list.mockRejectedValueOnce(new Error('Permission denied'))
    render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )

    expect(await screen.findByText('Files')).toBeInTheDocument()
    expect(workspace.list).toHaveBeenCalledExactlyOnceWith({
      rootId: 'primary',
      rootPath: '/workspace',
    })
    expect(
      screen.queryByRole('button', { name: 'Open files sidebar' })
    ).not.toBeInTheDocument()
  })

  it('keeps visible Files open when folder discovery fails on refresh', async () => {
    const refresh = deferred<typeof workspace.entries>()
    const { rerender } = render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )
    expect(await screen.findByText('Files')).toBeInTheDocument()
    workspace.list.mockReturnValueOnce(refresh.promise)

    rerender(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={1}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )
    await act(async () => {
      refresh.reject(new Error('Folder is unavailable'))
      await refresh.promise.catch(() => undefined)
    })

    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open files sidebar' })
    ).not.toBeInTheDocument()
  })

  it('respects manually closed Files across repeated discovery failures', async () => {
    workspace.list.mockRejectedValue(new Error('Permission denied'))
    const { rerender } = render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close files sidebar' })
    )
    await waitFor(() => {
      expect(screen.queryByText('Files')).not.toBeInTheDocument()
    })

    for (const refreshKey of [1, 2]) {
      await act(async () => {
        rerender(
          <AgentWorkspaceLayout
            threadId="thread"
            workspace={agentWorkspace}
            onAddExternal={onAddExternal}
            refreshKey={refreshKey}
          >
            <div>Chat</div>
          </AgentWorkspaceLayout>
        )
      })
      expect(screen.queryByText('Files')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Open files sidebar' })
      ).toBeInTheDocument()
    }
    expect(workspace.list).toHaveBeenCalledTimes(3)
  })

  it('ignores a previous folder discovery rejection after switching workspace', async () => {
    const previous = deferred<typeof workspace.entries>()
    workspace.list
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce([])
    const { rerender } = render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )
    const nextWorkspace = {
      primaryRoot: {
        rootId: 'next',
        path: '/next',
        name: 'next',
        canEdit: true,
      },
      externalRoots: [],
    }

    await act(async () => {
      rerender(
        <AgentWorkspaceLayout
          threadId="thread"
          workspace={nextWorkspace}
          onAddExternal={onAddExternal}
          refreshKey={0}
        >
          <div>Next chat</div>
        </AgentWorkspaceLayout>
      )
    })
    expect(workspace.list).toHaveBeenNthCalledWith(2, {
      rootId: 'next',
      rootPath: '/next',
    })

    await act(async () => {
      previous.reject(new Error('Old folder is unavailable'))
      await previous.promise.catch(() => undefined)
    })

    expect(screen.getByText('Next chat')).toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open files sidebar' })
    ).toBeInTheDocument()
  })

  it('opens the files sidebar when an empty workspace gains an entry', async () => {
    workspace.entries = []
    const { rerender } = render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )

    await waitFor(() => {
      expect(screen.queryByText('Files')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Open files sidebar' })
      ).toBeInTheDocument()
    })

    workspace.entries = [
      { name: 'result.txt', path: 'result.txt', kind: 'file' },
    ]
    rerender(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={1}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )

    expect(await screen.findByText('Files')).toBeInTheDocument()
  })

  it('starts an empty Agent workspace at full chat width', async () => {
    workspace.entries = []
    render(
      <AgentWorkspaceLayout
        threadId="home"
        workspace={{ externalRoots: [] }}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Agent home</div>
      </AgentWorkspaceLayout>
    )

    await waitFor(() => {
      expect(screen.queryByText('Files')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('panel-agent-chat')).toHaveAttribute(
      'data-default-size',
      '100'
    )
    expect(screen.getByTestId('panel-agent-files')).toHaveAttribute(
      'data-default-size',
      '0'
    )
  })

  it('opens the files sidebar when an empty external folder is connected', async () => {
    workspace.entries = []
    render(
      <AgentWorkspaceLayout
        threadId="home"
        workspace={{
          externalRoots: [
            {
              rootId: 'external',
              path: '/external',
              name: 'external',
              canEdit: true,
            },
          ],
        }}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Agent home</div>
      </AgentWorkspaceLayout>
    )

    expect(await screen.findByText('Files')).toBeInTheDocument()
  })

  it('opens preview space without changing the files panel width', async () => {
    render(
      <AgentWorkspaceLayout
        threadId="thread"
        workspace={agentWorkspace}
        onAddExternal={onAddExternal}
        refreshKey={0}
      >
        <div>Chat</div>
      </AgentWorkspaceLayout>
    )

    act(() => {
      useWorkspacePreviewStore.getState().openFile({
        rootId: 'primary',
        rootPath: '/workspace',
        relativePath: 'poem.txt',
      })
    })

    await waitFor(() => {
      expect(panelLayouts.values.at(-1)).toEqual([52, 24, 24])
    })
  })
})
