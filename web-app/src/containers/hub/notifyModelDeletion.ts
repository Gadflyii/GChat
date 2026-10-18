import { createElement } from 'react'
import { toast } from 'sonner'
import type { ServiceHub } from '@/services'
import { ModelDeletionNotice } from './ModelDeletionNotice'

/** Lives in the global toaster because successful deletion can unmount its row. */
export function notifyModelDeletion(props: {
  serviceHub: ServiceHub
  modelId: string
  title: string
  description: string
  refreshError: string | null
}) {
  const { modelId, title, description, refreshError } = props
  if (refreshError === null) {
    toast.success(title, { id: `delete-model-${modelId}`, description })
  } else {
    toast.warning(title, {
      id: `delete-model-${modelId}`,
      duration: Infinity,
      description: createElement(ModelDeletionNotice, { ...props, refreshError }),
    })
  }
}
