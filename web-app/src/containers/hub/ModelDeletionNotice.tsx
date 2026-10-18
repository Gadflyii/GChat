import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { refreshModelProviders } from '@/lib/model-deletion'
import type { ServiceHub } from '@/services'

type ModelDeletionNoticeProps = {
  serviceHub: ServiceHub
  modelId: string
  title: string
  description: string
  refreshError: string
}

export function ModelDeletionNotice({
  serviceHub,
  modelId,
  title,
  description,
  refreshError,
}: ModelDeletionNoticeProps) {
  const [error, setError] = useState(refreshError)
  const [refreshing, setRefreshing] = useState(false)
  const pending = useRef(false)

  const refresh = async () => {
    if (pending.current) return
    pending.current = true
    setRefreshing(true)
    try {
      await refreshModelProviders(serviceHub)
      toast.success(title, {
        id: `delete-model-${modelId}`,
        description: `${description} The model list is up to date.`,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setRefreshing(false)
    }
  }

  return <div className="space-y-2">
    <p>{description}</p>
    <p>The model list could not be refreshed. Choose Refresh model list to try again.</p>
    <details>
      <summary className="cursor-pointer">Technical details</summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{error}</p>
    </details>
    <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
      {refreshing ? 'Refreshing model list…' : 'Refresh model list'}
    </Button>
  </div>
}

