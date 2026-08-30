import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn, isLlamacppProvider } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAgentMode, type SidebarMode } from '@/hooks/useAgentMode'
import { useModelProvider } from '@/hooks/useModelProvider'
import { ChatAgentModeSwitch } from '@/containers/ChatAgentModeSwitch'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { localStorageKey } from '@/constants/localStorage'
import { route } from '@/constants/routes'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
  SettingsIcon,
  type SettingsIconHandle,
} from '@/components/animated-icon/settings'
import { useRef, useState } from 'react'
import { ServerQuickActions } from './ServerQuickActions'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

export function LeftSidebar() {
  const { t } = useTranslation()
  const isLeftPanelOpen = useLeftPanel((state) => state.open)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const sidebarMode = useAgentMode((state) => state.sidebarMode)
  const setSidebarMode = useAgentMode((state) => state.setSidebarMode)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const providers = useModelProvider((state) => state.providers)
  const isAgentProviderSelected =
    isLlamacppProvider(selectedProvider) ||
    providers.some((p) => isLlamacppProvider(p.provider))
  const settingsIconRef = useRef<SettingsIconHandle>(null)
  const [showAgentAttention, setShowAgentAttention] = useState(
    () =>
      localStorage.getItem(localStorageKey.agentModeAttentionSeen) !== 'true'
  )

  const selectMode = (mode: SidebarMode) => {
    if (mode === 'agent' && !isAgentProviderSelected) return
    if (mode === 'agent' && showAgentAttention) {
      localStorage.setItem(localStorageKey.agentModeAttentionSeen, 'true')
      setShowAgentAttention(false)
    }
    setSidebarMode(mode)
    useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, mode === 'agent')
    navigate({ to: route.home })
  }

  return (
    <div className="relative z-50">
      <Sidebar variant="floating" collapsible="offcanvas">
        {/*
          On macOS the window uses ``titleBarStyle: "Overlay"`` (see
          ``src-tauri/tauri.macos.conf.json``), so the red/yellow/green
          traffic-light controls are painted on top of our chrome at
          ~y=14, x=14-66 of the window. The first header row (download +
          sidebar toggle) is right-aligned, so it sits well clear of the
          left-edge traffic-light cluster and can share the same Y-coord
          with the system buttons. We therefore keep that row at the top
          and instead push only the left-aligned GChat logo row
          below the traffic-light band, so it doesn't collide.
        */}
        <SidebarHeader className="flex flex-col gap-1 px-1 pb-0">
          {/* SidebarTrigger and DownloadManagement are <button> elements that
              Tauri's drag handler explicitly excludes, so they remain clickable. */}
          <div
            className={cn(
              'flex w-full items-center',
              IS_WINDOWS ? 'justify-between' : 'justify-end'
            )}
            {...(IS_MACOS ? { 'data-tauri-drag-region': true } : {})}
          >
            {IS_WINDOWS && (
              <span className="pl-2 text-[10px] font-medium text-muted-foreground">
                v{VERSION}
              </span>
            )}
            <div className="flex items-center">
              {isLeftPanelOpen && <DownloadManagement />}
              <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 relative z-50 ml-0.5" />
            </div>
          </div>
          <div
            className={cn(
              'mt-1 flex h-16 w-full items-center justify-start overflow-hidden pl-2',
              IS_MACOS && 'mt-3'
            )}
          >
            <img
              src="/images/gchat-lockup.png"
              alt="GChat by Sectile Research Laboratories"
              className="h-15 max-w-none shrink-0 object-contain dark:hidden"
              draggable={false}
            />
            <img
              src="/images/gchat-lockup-reversed.png"
              alt="GChat by Sectile Research Laboratories"
              className="hidden h-15 max-w-none shrink-0 object-contain dark:block"
              draggable={false}
            />
          </div>
          <div className="mt-[6px] px-1">
            <ChatAgentModeSwitch
              isAgentMode={sidebarMode === 'agent'}
              onChange={(isAgent) => selectMode(isAgent ? 'agent' : 'chat')}
              chatLabel={t('chat:agentMode.chat')}
              agentLabel={t('chat:agentMode.agent')}
              agentDisabled={!isAgentProviderSelected}
              agentDisabledTooltip={t('chat:agentMode.providerUnavailable')}
              showAgentAttention={showAgentAttention}
            />
          </div>
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          <NavMain mode={sidebarMode} />
          {sidebarMode === 'chat' && <NavProjects />}
          <NavChats mode={sidebarMode} />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <ServerQuickActions />
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/settings')}
                className="data-[active=true]:bg-sidebar-foreground/15"
                onMouseEnter={() => settingsIconRef.current?.startAnimation()}
                onMouseLeave={() => settingsIconRef.current?.stopAnimation()}
              >
                <Link to={route.settings.general}>
                  <SettingsIcon
                    ref={settingsIconRef}
                    className="text-foreground/70"
                    size={16}
                  />
                  <span>{t('common:settings')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
