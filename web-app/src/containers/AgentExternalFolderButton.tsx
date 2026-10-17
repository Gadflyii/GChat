import { IconFolderPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { resolveConversationWorkspaceRoot } from '@/services/agent/tauri'

type AgentExternalFolderButtonProps = {
  workspaceKey: string
  onAdded?: () => void
}

export function AgentExternalFolderButton({
  workspaceKey,
  onAdded,
}: AgentExternalFolderButtonProps) {
  const serviceHub = useServiceHub()
  const { t } = useTranslation('chat')
  const [busy, setBusy] = useState(false)

  const addFolder = async () => {
    if (busy) return
    setBusy(true)
    try {
      const selected = await serviceHub.dialog().open({
        multiple: false,
        directory: true,
      })
      if (typeof selected !== 'string') return

      const root = await resolveConversationWorkspaceRoot(selected)
      useConversationPolicy.getState().addExternalRoot(workspaceKey, {
        ...root,
        canEdit: true,
      })
      onAdded?.()
    } catch (reason) {
      toast.error(t('agentWorkspace.addFolderFailed'), {
        description: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
      title={t('agentWorkspace.addFolder')}
      aria-label={t('agentWorkspace.addFolder')}
      aria-busy={busy}
      disabled={busy}
      onClick={() => void addFolder()}
    >
      <IconFolderPlus className="size-4" />
    </button>
  )
}
