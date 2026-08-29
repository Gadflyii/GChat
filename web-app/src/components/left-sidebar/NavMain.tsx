import { useRef } from 'react'
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

  const handleNewChat = () => {
    useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, mode === 'agent')
    navigate({ to: route.home })
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
            onClick={handleNewChat}
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
