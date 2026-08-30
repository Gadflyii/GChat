import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { BlocksIcon } from '@/components/animated-icon/blocks'
import { FolderPlusIcon } from '@/components/animated-icon/folder-plus'
import { ListTodoIcon } from '@/components/animated-icon/list-todo'
import { MessageCircleIcon } from '@/components/animated-icon/message-circle'
import { PlugIcon, type PlugIconHandle } from '@/components/animated-icon/plug'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { SearchDialog } from '@/containers/dialogs/SearchDialog'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useProjectDialog } from '@/hooks/useProjectDialog'
import { useSearchDialog } from '@/hooks/useSearchDialog'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import type { SidebarMode } from '@/hooks/useAgentMode'
import { IconSparkles, IconTerminal2 } from '@tabler/icons-react'
import { toast } from 'sonner'
import { useMessages } from '@/hooks/useMessages'
import { usePrompt } from '@/hooks/usePrompt'
import { useInitialMessage } from '@/hooks/useInitialMessage'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'
import { useAgentRun } from '@/hooks/useAgentRun'
import {
  cancelAgentTurn,
  resetAgentSession,
} from '@/services/agent/tauri'

type AnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

export function NavMain({ mode }: { mode: SidebarMode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const newChatIconRef = useRef<AnimatedIconHandle>(null)
  const modelsIconRef = useRef<AnimatedIconHandle>(null)
  const projectIconRef = useRef<AnimatedIconHandle>(null)
  const integrationsIconRef = useRef<PlugIconHandle>(null)
  const integrationsBadgeSeen = useGeneralSetting(
    (state) => state.integrationsBadgeSeen
  )
  const { addFolder } = useThreadManagement()
  const projectDialogOpen = useProjectDialog((state) => state.open)
  const setProjectDialogOpen = useProjectDialog((state) => state.setOpen)
  const { open: searchOpen, setOpen: setSearchOpen } = useSearchDialog()
  const [creatingConversation, setCreatingConversation] = useState(false)

  const handleNewChat = async () => {
    if (creatingConversation) return
    setCreatingConversation(true)
    try {
      if (mode === 'agent') {
        const run = useAgentRun.getState().getRun(TEMPORARY_CHAT_ID)
        if (
          run.runId &&
          ['running', 'awaiting_approval', 'awaiting_folder_access'].includes(
            run.status
          )
        ) {
          await cancelAgentTurn(run.runId).catch(() => undefined)
        }
        await resetAgentSession(TEMPORARY_CHAT_ID)
      }
      useMessages.getState().setMessages(TEMPORARY_CHAT_ID, [])
      usePrompt.getState().resetPrompt()
      useInitialMessage.getState().clear(TEMPORARY_CHAT_ID)
      useChatAttachments
        .getState()
        .clearAttachments(NEW_THREAD_ATTACHMENT_KEY)
      useChatAttachments.getState().clearAttachments(TEMPORARY_CHAT_ID)
      useAgentRun.getState().clearRun(TEMPORARY_CHAT_ID)
      useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, mode === 'agent')
      navigate({ to: route.home, search: {} })
    } catch (error) {
      toast.error(
        mode === 'agent' ? 'Could not create a new task' : 'Could not create a new chat',
        { description: String(error) }
      )
    } finally {
      setCreatingConversation(false)
    }
  }

  const handleCreateProject = async (name: string, assistantId?: string) => {
    const project = await addFolder(name, assistantId)
    setProjectDialogOpen(false)
    navigate({
      to: '/project/$projectId',
      params: { projectId: project.id },
    })
  }

  return (
    <>
      <SidebarMenu className="mt-3 px-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            className="font-medium"
            disabled={creatingConversation}
            onClick={() => void handleNewChat()}
            onMouseEnter={() => newChatIconRef.current?.startAnimation()}
            onMouseLeave={() => newChatIconRef.current?.stopAnimation()}
          >
            {mode === 'agent' ? (
              <ListTodoIcon
                ref={newChatIconRef}
                className="text-foreground/70"
                size={16}
              />
            ) : (
              <MessageCircleIcon
                ref={newChatIconRef}
                className="text-foreground/70"
                size={16}
              />
            )}
            <span>
              {mode === 'agent' ? t('common:newTask') : t('common:newChat')}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={pathname.startsWith('/code')}
            className="data-[active=true]:bg-sidebar-foreground/15"
          >
            <Link to={route.code.index}>
              <IconTerminal2 className="size-4 text-foreground/70" />
              <span>{t('common:code')}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={pathname.startsWith('/agents')}
            className="data-[active=true]:bg-sidebar-foreground/15"
          >
            <Link to={route.agents.index}>
              <IconSparkles className="size-4 text-foreground/70" />
              <span>Agent Studio</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={pathname.startsWith('/hub')}
            className="data-[active=true]:bg-sidebar-foreground/15"
            onMouseEnter={() => modelsIconRef.current?.startAnimation()}
            onMouseLeave={() => modelsIconRef.current?.stopAnimation()}
          >
            <Link to={route.hub.index}>
              <BlocksIcon
                ref={modelsIconRef}
                className="text-foreground/70"
                size={16}
              />
              <span>{t('common:models')}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {mode === 'chat' && (
          <>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setProjectDialogOpen(true)}
                onMouseEnter={() => projectIconRef.current?.startAnimation()}
                onMouseLeave={() => projectIconRef.current?.stopAnimation()}
              >
                <FolderPlusIcon
                  ref={projectIconRef}
                  className="text-foreground/70"
                  size={16}
                />
                <span>{t('common:projects.new')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/launch')}
                className="data-[active=true]:bg-sidebar-foreground/15"
                onMouseEnter={() =>
                  integrationsIconRef.current?.startAnimation()
                }
                onMouseLeave={() =>
                  integrationsIconRef.current?.stopAnimation()
                }
              >
                <Link to={route.launch.index}>
                  <PlugIcon
                    ref={integrationsIconRef}
                    className="text-foreground/70"
                    size={16}
                  />
                  <span>{t('common:launch')}</span>
                  {!integrationsBadgeSeen && (
                    <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
                      {t('common:newBadge')}
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </>
        )}
      </SidebarMenu>
      <AddProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        editingKey={null}
        onSave={handleCreateProject}
      />
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        mode={mode}
      />
    </>
  )
}
