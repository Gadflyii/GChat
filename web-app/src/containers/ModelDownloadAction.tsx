import { Button } from '@/components/ui/button'
import { route } from '@/constants/routes'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { DeleteModelAction } from '@/containers/hub/DeleteModelAction'
import { markDownloadCancellationRequested } from '@/lib/downloadCancellation'
import {
  findInstalledLocalModel,
  GINFER_PROVIDER,
  quantModelIds,
} from '@/lib/hub-installed'
import { CatalogModel } from '@/services/models/types'

import { switchToModel } from '@/utils/switchModel'
import { IconDownload, IconX } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

export const ModelDownloadAction = ({
  variant,
  model,
  asButton = false,
  deletable = false,
}: {
  variant: { model_id: string; path: string }
  model: CatalogModel
  // Render the idle state as a labelled outline "Download" button (Hub v12
  // variant rows) instead of the compact icon used elsewhere (SetupScreen).
  asButton?: boolean
  // Offer a trash button next to "New chat" once the variant is on disk. Opt-in
  // so the onboarding screens keep a single, unambiguous action.
  deletable?: boolean
}) => {
  const serviceHub = useServiceHub()

  const { t } = useTranslation()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const {
    downloads,
    localDownloadingModels,
    resumableDownloads,
    downloadOriginByModelId,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
    markResumableDownload,
    clearResumableDownload,
    setDownloadOrigin,
    clearDownloadOrigin,
  } = useDownloadStore()
  const downloadProcesses = useMemo(
    () =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      })),
    [downloads]
  )

  const navigate = useNavigate()

  const handleUseModel = useCallback(
    (modelId: string) => {
      useModelProvider
        .getState()
        .selectModelProvider(GINFER_PROVIDER, modelId)
      switchToModel({
        modelId,
        providerName: GINFER_PROVIDER,
        serviceHub,
      }).catch((error) => {
        console.error('[ModelDownloadAction] switchToModel failed:', error)
      })
      navigate({
        to: route.home,
        params: {},
        search: {
          threadModel: {
            id: modelId,
            provider: GINFER_PROVIDER,
          },
        },
      })
    },
    [navigate, serviceHub]
  )

  const handleDownloadModel = useCallback(async () => {
    clearResumableDownload(variant.model_id)
    addLocalDownloadingModel(variant.model_id)
    setDownloadOrigin(variant.model_id, model.model_name)
    try {
      await serviceHub
        .models()
        .pullModelWithMetadata(
          variant.model_id,
          variant.path,
          huggingfaceToken,
          true,
          resumableDownloads.has(variant.model_id),
          GINFER_PROVIDER
        )
    } catch (error) {
      // If pull rejects before any DownloadEvent fires, the global listener in
      // DownloadManegement.tsx never clears localDownloadingModels and the row
      // is stuck in a permanent "downloading" state. Clear it ourselves.
      console.error(
        '[ModelDownloadAction] pullModelWithMetadata failed:',
        error
      )
      removeLocalDownloadingModel(variant.model_id)
      clearDownloadOrigin(variant.model_id)
      markResumableDownload(variant.model_id)
      toast.error(t('hub:downloadFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    serviceHub,
    variant.path,
    variant.model_id,
    huggingfaceToken,
    model.model_name,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
    markResumableDownload,
    clearResumableDownload,
    setDownloadOrigin,
    clearDownloadOrigin,
    resumableDownloads,
    t,
  ])

  const handleCancelDownload = useCallback(() => {
    markResumableDownload(variant.model_id)
    markDownloadCancellationRequested(variant.model_id)
    void serviceHub.models().abortDownload(variant.model_id)
  }, [markResumableDownload, serviceHub, variant.model_id])

  // See ``DownloadButton.tsx`` for the rationale -- defensive UI guard
  // against catalog-level ``quant.model_id`` collisions across repos.
  const downloadOrigin = downloadOriginByModelId[variant.model_id]
  const isOriginConflict =
    downloadOrigin !== undefined && downloadOrigin !== model.model_name
  const isDownloading =
    !isOriginConflict &&
    (localDownloadingModels.has(variant.model_id) ||
      downloadProcesses.some((e) => e.id === variant.model_id))
  const downloadProgress =
    downloadProcesses.find((e) => e.id === variant.model_id)?.progress || 0
  const providers = useModelProvider((state) => state.providers)
  const installed = useMemo(
    () => findInstalledLocalModel(providers, quantModelIds(model, variant.model_id)),
    [providers, model, variant.model_id]
  )
  const isDownloaded = installed !== null

  if (isDownloading) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCancelDownload}
        title={t('common:cancelDownload')}
        aria-label={t('common:cancelDownload')}
        className="group relative w-24 justify-center overflow-hidden font-semibold"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 z-0 bg-primary/20 transition-[width] duration-200"
          style={{ width: `${Math.round(downloadProgress * 100)}%` }}
        />
        <span className="relative z-1 tabular-nums transition-opacity group-hover:opacity-0">
          {Math.round(downloadProgress * 100)}%
        </span>
        <span className="absolute inset-0 z-1 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <IconX size={14} />
        </span>
      </Button>
    )
  }

  if (isDownloaded && installed) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="default"
          size="sm"
          onClick={() => handleUseModel(installed.modelId)}
          title={t('hub:useModel')}
        >
          {t('hub:newChat')}
        </Button>
        {deletable && (
          <DeleteModelAction
            modelId={installed.modelId}
            provider={installed.provider}
          />
        )}
      </div>
    )
  }

  if (asButton) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleDownloadModel}
        title={t('hub:downloadModel')}
        className="font-semibold"
      >
        {t('hub:download')}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t('hub:downloadModel')}
      title={t('hub:downloadModel')}
      onClick={handleDownloadModel}
      className="size-6"
    >
      <IconDownload size={16} className="text-muted-foreground" />
    </Button>
  )
}
