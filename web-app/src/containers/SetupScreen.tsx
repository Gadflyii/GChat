import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { AppEvent, events } from '@gchat/core'
import { Cloud } from 'lucide-react'
import type {
  CatalogModel,
  ModelQuant,
} from '@/services/models/types'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn, sanitizeModelId, LOCAL_LLAMACPP_PROVIDER } from '@/lib/utils'
import {
  extractModelName,
  getTotalDownloadFileSize,
} from '@/lib/models'
import { useResolvedRecommendedModels } from '@/hooks/useResolvedRecommendedModels'
import { useHardwareTier } from '@/hooks/useHardwareTier'
import {
  AddCloudProviderDialog,
  selectCloudGalleryProviders,
  type CloudProviderSaveResult,
} from '@/containers/dialogs/AddCloudProviderDialog'
import { findPinnedQuant } from '@/lib/model-card'
import { useRecommendedModelsRegistryStore } from '@/stores/recommended-models-registry-store'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelLoad } from '@/hooks/useModelLoad'
import { useOnboardingModelReminderStore } from '@/hooks/useOnboardingModelReminder'
import { switchToModel } from '@/utils/switchModel'
import HeaderPage from './HeaderPage'
import { useModelSources } from '@/hooks/useModelSources'
import { useShallow } from 'zustand/shallow'
import { HuggingFaceAuthorAvatar } from '@/components/HuggingFaceAuthorAvatar'
import { RecommendedModelChip } from '@/components/RecommendedModelChip'
import { chipVariantForRecommendedDescriptionKey } from '@/constants/recommendedModelChip'
import { modelFamilyLogoSrc } from '@/lib/model-logo'
import posthog from 'posthog-js'
import { getAnalyticsPlatform } from '@/lib/telemetry'
import {
  captureOnboardingCompleted,
  captureSetupLocalModelRun,
  captureSetupScreenShown,
} from '@/lib/onboarding-telemetry'

//* Вариант загрузки: пин из манифеста, иначе приоритет квантов как в Hub.
//! Пин обязателен для LFM2.5-VL-450M (нужен Q8_0): репозиторий отдаёт и Q4_K_M,
//! который матчится DEFAULT_MODEL_QUANTIZATIONS — без пина скачается рабочий,
//! но не тот файл, и ошибка не всплывёт нигде.
function pickPreferredVariant(
  model: CatalogModel,
  quantPin?: string
): ModelQuant | null {
  const pinned = findPinnedQuant(model.quants, quantPin)
  if (pinned) return pinned
  const preferred =
    model.quants?.find((m) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
        m.model_id.toLowerCase().includes(e)
      )
    ) ?? null
  return preferred ?? model.quants?.[0] ?? null
}

//* ГБ для строки прогресса (как в DownloadManagement)
function formatDownloadGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2)
}

//* Числовой размер в ГБ из строки каталога ("4.5 GB" / "850 MB") для аналитики.
function sizeStringToGb(size?: string): number | undefined {
  if (!size) return undefined

  const match = size.trim().match(/^([\d.]+)\s*(MB|GB)$/i)
  if (!match) return undefined

  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined

  const gb = match[2].toUpperCase() === 'GB' ? value : value / 1024
  return Math.round(gb * 100) / 100
}

//* Иконка бренда по id репозитория HF (см. modelFamilyLogoSrc)
const recommendedSetupModelIconSrc = modelFamilyLogoSrc

type SetupScreenProps = {
  onSkipped?: () => void
}

/// Onboarding must never trap the user behind a multi-gigabyte decision: if the
/// model step is left untouched for this long we enter the chat anyway and hand
/// the recommendation over to the bottom-right reminder.
const MODEL_STEP_AUTO_EXIT_MS = 15_000

/// The hardware enumeration may not hold the picker hostage: it is raced
/// against this deadline; whatever has not answered by then is treated as
/// "assume a standard machine".
const PICKER_INPUT_DEADLINE_MS = 4_000

function SetupScreen({ onSkipped }: SetupScreenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { providers, getProviderByName, selectModelProvider, setProviders } =
    useModelProvider()

  const {
    downloads,
    localDownloadingModels,
    resumableDownloads,
    addLocalDownloadingModel,
    clearResumableDownload,
  } = useDownloadStore()
  const serviceHub = useServiceHub()
  // The only local inference provider id; `isVariantDownloaded` checks it.
  const llamaProvider = getProviderByName(LOCAL_LLAMACPP_PROVIDER)
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)

  const {
    sources,
    fetchSources,
    loading: sourcesLoading,
  } = useModelSources(
    useShallow((state) => ({
      sources: state.sources,
      fetchSources: state.fetchSources,
      loading: state.loading,
    }))
  )

  // Ids of downloads we started here, so a matching import event navigates.
  const trackedImportIdsRef = useRef<Set<string>>(new Set())
  const hasNavigatedRef = useRef(false)
  // Wall clock for `onboarding_completed.duration_ms` — how long the user spent
  // in the flow before whichever exit they took.
  const onboardingStartedAtRef = useRef(Date.now())

  // The tier decides which two models the picker advertises, so rendering
  // before it is known would swap the whole list under the user. Hardware
  // enumeration starts at app boot and is normally done well before onboarding
  // paints, so this deadline is a backstop, not a routine wait.
  // Open state is mirrored into a ref because the auto-exit timeout callback
  // below closes over its own render's value.
  const [cloudDialogOpen, setCloudDialogOpen] = useState(false)
  const cloudDialogOpenRef = useRef(false)
  const setCloudDialog = useCallback((open: boolean) => {
    cloudDialogOpenRef.current = open
    setCloudDialogOpen(open)
  }, [])

  const [tierDeadlineElapsed, setTierDeadlineElapsed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(
      () => setTierDeadlineElapsed(true),
      PICKER_INPUT_DEADLINE_MS
    )
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  // Onboarding owns model launching for the duration of the setup screen, so
  // DataProvider must stand down from auto-launching the background bulk-imports
  // (see DataProvider.handleModelImported). Error toasts are NOT muted here —
  // every onboarding load is dispatched with `isAutoStart`, which already keeps
  // failed auto-starts silent. We still clear any stale toast on entry.
  useEffect(() => {
    useModelLoad.getState().setOnboardingActive(true)
    toast.dismiss('model-load-error')
    return () => {
      useModelLoad.getState().setOnboardingActive(false)
    }
  }, [])

  const { tier: hardwareTier, ready: hardwareTierReady } = useHardwareTier()
  const recommendedItems = useResolvedRecommendedModels(sources, hardwareTier)

  // Every input the picker needs before it can paint a stable list.
  const pickerInputsPending = !hardwareTierReady && !tierDeadlineElapsed

  //* P0 онбординг-аналитика: фиксируем показ экрана выбора модели один раз,
  //* дождавшись резолва списка рекомендаций (иначе recommended_count = 0).
  const setupShownFiredRef = useRef(false)
  useEffect(() => {
    if (setupShownFiredRef.current) return
    if (pickerInputsPending) return
    if (recommendedItems.length === 0 && sourcesLoading) return
    setupShownFiredRef.current = true
    captureSetupScreenShown({
      recommendedCount: recommendedItems.length,
      rendered: true,
      hardwareTier,
      hardwareTierResolved: hardwareTierReady,
    })
  }, [
    pickerInputsPending,
    recommendedItems.length,
    sourcesLoading,
    hardwareTier,
    hardwareTierReady,
  ])

  //* P0: клик «Download» на рекомендованной карточке (до старта загрузки).
  const captureRecommendedClick = useCallback(
    (params: {
      modelId: string
      format: string
      sizeGb?: number
      position: number
    }) => {
      try {
        posthog.capture('recommended_model_clicked', {
          model_id: params.modelId,
          size_gb: params.sizeGb ?? null,
          format: params.format,
          position: params.position,
          platform: getAnalyticsPlatform(),
          app_version: VERSION,
        })
      } catch (err) {
        console.debug('recommended_model_clicked telemetry failed:', err)
      }
    },
    []
  )

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

  const isVariantDownloading = useCallback(
    (variantId: string) =>
      localDownloadingModels.has(variantId) ||
      downloadProcesses.some((e) => e.id === variantId),
    [localDownloadingModels, downloadProcesses]
  )

  const isVariantDownloaded = useCallback(
    (catalog: CatalogModel, variant: ModelQuant) =>
      llamaProvider?.models.some(
        (m: { id: string }) =>
          m.id === variant.model_id ||
          m.id === `${catalog.developer}/${sanitizeModelId(variant.model_id)}`
      ) ?? false,
    [llamaProvider]
  )

  //* Уже установленные рекомендованные модели переезжают в секцию «На вашем
  //* устройстве» с живой кнопкой запуска; остальные остаются в рекомендациях.
  const { installedRecommended, pendingRecommended } = useMemo(() => {
    const installed: Array<{
      rec: (typeof recommendedItems)[number]['rec']
      model: CatalogModel
      startId: string
      provider: string
      sizeLabel: string | null | undefined
    }> = []
    const pending: typeof recommendedItems = []

    for (const item of recommendedItems) {
      const { model } = item
      if (!model) {
        pending.push(item)
        continue
      }
      const variant = pickPreferredVariant(model, item.rec.quant)
      const downloaded = variant
        ? isVariantDownloaded(model, variant)
        : false

      if (downloaded) {
        installed.push({
          rec: item.rec,
          model,
          startId: variant!.model_id,
          provider: LOCAL_LLAMACPP_PROVIDER,
          sizeLabel: getTotalDownloadFileSize(model, variant!),
        })
      } else {
        pending.push(item)
      }
    }

    return { installedRecommended: installed, pendingRecommended: pending }
  }, [recommendedItems, isVariantDownloaded])

  const startDownload = useCallback(
    (variant: ModelQuant) => {
      trackedImportIdsRef.current.add(variant.model_id)
      clearResumableDownload(variant.model_id)
      addLocalDownloadingModel(variant.model_id)
      serviceHub
        .models()
        .pullModelWithMetadata(
          variant.model_id,
          variant.path,
          huggingfaceToken,
          true,
          resumableDownloads.has(variant.model_id)
        )
    },
    [
      addLocalDownloadingModel,
      clearResumableDownload,
      serviceHub,
      huggingfaceToken,
      resumableDownloads,
    ]
  )

  useEffect(() => {
    const handleImportedId = async (importedId: string, providerName: string) => {
      if (hasNavigatedRef.current) return
      hasNavigatedRef.current = true
      captureOnboardingCompleted({
        exitPath: 'imported',
        hadAnyModel: true,
        stepReached: 'model',
        startedAtMs: onboardingStartedAtRef.current,
      })
      trackedImportIdsRef.current.delete(importedId)

      const providers = await serviceHub.providers().getProviders()
      setProviders(providers)

      const catalogId = importedId
      const backslashId = catalogId.replace(/\//g, '\\')

      // Select up-front so the dropdown "first local" fallback can't override it.
      const prov = providers.find((p) => p.provider === providerName)
      const found = prov?.models.find(
        (m) => m.id === catalogId || m.id === backslashId
      )
      const modelId = found ? found.id : catalogId
      selectModelProvider(providerName, modelId)

      toast.dismiss(`model-validation-started-${catalogId}`)
      localStorage.setItem(localStorageKey.setupCompleted, 'true')

      // Same-tab signal — see useSetupCompleted.
      window.dispatchEvent(new Event('app:setup-completed'))
      localStorage.setItem(
        localStorageKey.lastUsedModel,
        JSON.stringify({ provider: providerName, model: modelId })
      )

      useLeftPanel.getState().setLeftPanel(true)

      // Explicit user pick (not an auto-start) so a load error surfaces on the
      // model they clicked. Fire-and-forget so nav isn't blocked on weights.
      void switchToModel({
        modelId,
        providerName,
        serviceHub,
      }).catch(() => {})

      navigate({
        to: route.home,
        replace: true,
        search: {
          threadModel: { id: modelId, provider: providerName },
        },
      })
    }

    const onModelImported = (payload: { modelId: string }) => {
      if (!trackedImportIdsRef.current.has(payload.modelId)) return
      void handleImportedId(payload.modelId, LOCAL_LLAMACPP_PROVIDER)
    }

    events.on(AppEvent.onModelImported, onModelImported)

    return () => {
      events.off(AppEvent.onModelImported, onModelImported)
    }
  }, [navigate, selectModelProvider, serviceHub, setProviders])

  const enterChatForDownload = useCallback(
    (modelId: string, providerName: string) => {
      if (hasNavigatedRef.current) return

      hasNavigatedRef.current = true
      captureOnboardingCompleted({
        exitPath: 'download_started',
        hadAnyModel: true,
        stepReached: 'model',
        startedAtMs: onboardingStartedAtRef.current,
      })
      localStorage.setItem(localStorageKey.setupCompleted, 'true')
      window.dispatchEvent(new Event('app:setup-completed'))
      localStorage.setItem(
        localStorageKey.lastUsedModel,
        JSON.stringify({ provider: providerName, model: modelId })
      )

      useLeftPanel.getState().setLeftPanel(true)

      void navigate({
        to: route.home,
        replace: true,
        search: {
          threadModel: { id: modelId, provider: providerName },
        },
      })
    },
    [navigate]
  )

  // Exit taken when the user connects a cloud provider instead of downloading
  // a model. Deliberately does NOT arm the bottom-right model reminder: that
  // nudge is for users who left empty-handed, and a configured key is a
  // finished setup, not an abandoned one.
  const enterChatWithCloudProvider = useCallback(
    ({ providerName, modelId }: CloudProviderSaveResult) => {
      if (hasNavigatedRef.current) return
      hasNavigatedRef.current = true

      captureOnboardingCompleted({
        exitPath: 'cloud_provider',
        hadAnyModel: true,
        stepReached: 'model',
        startedAtMs: onboardingStartedAtRef.current,
      })

      localStorage.setItem(localStorageKey.setupCompleted, 'true')
      window.dispatchEvent(new Event('app:setup-completed'))

      if (modelId) {
        // Select up-front so the dropdown's "first local" fallback cannot
        // override the provider the user just configured.
        selectModelProvider(providerName, modelId)
        localStorage.setItem(
          localStorageKey.lastUsedModel,
          JSON.stringify({ provider: providerName, model: modelId })
        )
      } else {
        localStorage.removeItem(localStorageKey.lastUsedModel)
      }

      useLeftPanel.getState().setLeftPanel(true)

      if (modelId) {
        // Registers the remote provider and starts the local proxy.
        // Fire-and-forget so navigation is not blocked on it.
        void switchToModel({ modelId, providerName, serviceHub }).catch(() => {})
      }

      void navigate({
        to: route.home,
        replace: true,
        search: modelId
          ? { threadModel: { id: modelId, provider: providerName } }
          : {},
      })
    },
    [navigate, selectModelProvider, serviceHub]
  )

  // Providers worth offering in the cloud dialog. Hidden rather than disabled
  // when empty, so onboarding never opens a dialog with nothing in it.
  const hasCloudProviders = useMemo(
    () => selectCloudGalleryProviders(providers).length > 0,
    [providers]
  )

  // Leaving onboarding empty-handed. Since the Skip link was removed this is
  // reachable only through the auto-exit timeout — the `reason` is kept on the
  // event so the existing `setup_skipped` funnel stays comparable across the
  // change. Picking a model takes a different route (handleImportedId /
  // enterChatForDownload) and must not arm the bottom-right reminder.
  const leaveWithoutModel = useCallback(
    (reason: 'timeout') => {
      if (hasNavigatedRef.current) return
      hasNavigatedRef.current = true

      try {
        const hadAnyModel = providers.some(
          (p) => (p.models?.length ?? 0) > 0 || !!p.api_key
        )
        posthog.capture('setup_skipped', {
          had_any_model: hadAnyModel,
          reason,
          platform: getAnalyticsPlatform(),
          app_version: VERSION,
        })
        captureOnboardingCompleted({
          exitPath: reason,
          hadAnyModel,
          stepReached: 'model',
          startedAtMs: onboardingStartedAtRef.current,
        })
      } catch (err) {
        console.debug('setup_skipped telemetry failed:', err)
      }
      localStorage.setItem(localStorageKey.setupCompleted, 'true')
      // Same-tab signal — see useSetupCompleted in routes/__root.tsx.
      window.dispatchEvent(new Event('app:setup-completed'))
      localStorage.removeItem(localStorageKey.lastUsedModel)
      useOnboardingModelReminderStore.getState().setPending(true)
      onSkipped?.()

      // Already open for the model step; kept so the main app is never entered
      // with a collapsed sidebar regardless of how this path is reached.
      useLeftPanel.getState().setLeftPanel(true)

      void navigate({
        to: route.home,
        replace: true,
        search: {},
      })
    },
    [navigate, onSkipped, providers]
  )

  // Read through a ref so the timeout below is armed once per model step
  // instead of being restarted every time a background import refreshes the
  // provider list.
  const leaveWithoutModelRef = useRef(leaveWithoutModel)
  useEffect(() => {
    leaveWithoutModelRef.current = leaveWithoutModel
  }, [leaveWithoutModel])

  // Armed only once the picker is actually on screen.
  useEffect(() => {
    // Do not start the 15s exit clock behind the loading screen.
    if (pickerInputsPending) return
    // Onboarding must not navigate out from under an open dialog.
    if (cloudDialogOpen) return

    const timer = setTimeout(() => {
      // Second layer, deliberately: the dependency above cancels a pending
      // timer when the dialog opens, but a click at t≈14.99s can fire this
      // callback before React commits that state update.
      if (cloudDialogOpenRef.current) return
      leaveWithoutModelRef.current('timeout')
    }, MODEL_STEP_AUTO_EXIT_MS)

    return () => clearTimeout(timer)
  }, [pickerInputsPending, cloudDialogOpen])

  // Unlike the previous full-screen onboarding, the model step lives inside the
  // chat area, so the sidebar is already there when the user lands in chat.
  useEffect(() => {
    useLeftPanel.getState().setLeftPanel(true)
  }, [])

  // The registry's one-hour cache is served without touching the network, which
  // is fine everywhere except here: onboarding is the one screen whose whole
  // content is the recommendation list, and showing a list the manifest no
  // longer contains is worse than a 5s fetch. Fires once per mount; the store
  // keeps the previous list meanwhile and falls back on its own if the fetch
  // fails, so there is nothing to await and nothing to unwind.
  const forcedRegistryRefreshRef = useRef(false)
  useEffect(() => {
    if (forcedRegistryRefreshRef.current) return
    forcedRegistryRefreshRef.current = true
    void useRecommendedModelsRegistryStore.getState().refresh({ force: true })
  }, [])

  // Brief loading state while the hardware tier resolves.
  const statusMessage = pickerInputsPending ? t('common:loading') : null

  if (statusMessage) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        <HeaderPage />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-muted-foreground text-sm">{statusMessage}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-full min-h-0 w-full flex-col">
        <HeaderPage />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="pointer-events-auto mx-auto my-auto flex w-full max-w-[520px] flex-col px-6 py-8 sm:py-10">
            <div className="mb-5 flex shrink-0 flex-col items-center gap-3 text-center">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-950 p-1 shadow-sm dark:bg-white dark:shadow-none">
                <img
                  src="/images/transparent-logo.png"
                  alt=""
                  className="size-full min-h-0 min-w-0 object-contain invert dark:invert-0"
                  draggable={false}
                />
              </div>
              <div>
                <h1 className="text-xl font-semibold leading-snug tracking-tight">
                  {t('setup:welcomeTitle')}
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t('setup:welcomeSubtitle')}
                </p>
              </div>
            </div>

            <div className="relative z-50 flex flex-col gap-4">
              {installedRecommended.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="shrink-0 text-left text-xs font-medium text-muted-foreground">
                    {t('setup:localStep.onDeviceTitle')}
                  </span>
                  <div
                    className={cn(
                      'w-full shrink-0 rounded-lg border bg-secondary/50 px-3 py-2',
                      'max-h-[min(40vh,22rem)] overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]'
                    )}
                  >
                    <div className="flex flex-col divide-y divide-border/60">
                      {installedRecommended.map(
                        ({ rec, model, startId, provider, sizeLabel }) => {
                          const brandIconSrc = recommendedSetupModelIconSrc(
                            rec.modelName
                          )
                          const hfAuthor =
                            model.developer?.trim() ||
                            rec.modelName.split('/')[0]?.trim() ||
                            ''
                          const rowInitials =
                            (extractModelName(rec.modelName) || rec.modelName)
                              .replace(/\.(gguf|GGUF)$/i, '')
                              .replace(/[^a-zA-Z0-9]/g, '')
                              .slice(0, 2) ||
                            hfAuthor.slice(0, 2) ||
                            '?'

                          return (
                            <div
                              key={`installed-${rec.modelName}-${rec.descriptionKey}`}
                              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                {brandIconSrc ? (
                                  <img
                                    src={brandIconSrc}
                                    alt=""
                                    className="size-8 shrink-0 object-contain"
                                    draggable={false}
                                    aria-hidden
                                  />
                                ) : (
                                  <HuggingFaceAuthorAvatar
                                    author={hfAuthor}
                                    initials={rowInitials}
                                    className="size-8 shrink-0"
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <h2 className="truncate text-sm font-medium leading-tight">
                                    {extractModelName(model.model_name)}
                                    {sizeLabel ? (
                                      <span className="text-xs font-normal text-muted-foreground">
                                        {' '}
                                        · {sizeLabel}
                                      </span>
                                    ) : null}
                                  </h2>
                                  <RecommendedModelChip
                                    className="mt-1 inline-flex max-w-full"
                                    variant={chipVariantForRecommendedDescriptionKey(
                                      rec.descriptionKey
                                    )}
                                    title={t(rec.descriptionKey)}
                                  >
                                    {t(rec.descriptionKey)}
                                  </RecommendedModelChip>
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    captureSetupLocalModelRun({
                                      trigger: 'installed_recommended',
                                      source: provider,
                                      format: 'ginfer',
                                    })
                                    enterChatForDownload(startId, provider)
                                  }}
                                  className="shrink-0 rounded-full px-4"
                                >
                                  {t('setup:localStep.run')}
                                </Button>
                              </div>
                            </div>
                          )
                        }
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {pendingRecommended.length > 0 && (
                  <>
                    <span className="shrink-0 text-left text-xs font-medium text-muted-foreground">
                      {t('hub:recTitle')}
                    </span>
                    <div
                      className={cn(
                        'w-full shrink-0 rounded-lg border bg-secondary/50 px-3 py-2',
                        'max-h-[min(70vh,36rem)] overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]'
                      )}
                    >
                      <div className="flex flex-col divide-y divide-border/60">
                        {pendingRecommended.map(({ rec, model }, index) => {
                          const variant = model
                            ? pickPreferredVariant(model, rec.quant)
                            : null
                          const downloadSize =
                            model && variant
                              ? getTotalDownloadFileSize(model, variant)
                              : variant?.file_size
                          //* id, по которому опрашиваем downloadStore
                          const rowTrackId = variant?.model_id ?? null
                          const rowDownloading = rowTrackId
                            ? isVariantDownloading(rowTrackId)
                            : false
                          const rowDownloaded =
                            model && variant
                              ? isVariantDownloaded(model, variant)
                              : false
                          const hfAuthor =
                            model?.developer?.trim() ||
                            rec.modelName.split('/')[0]?.trim() ||
                            ''
                          const nameForInitials =
                            extractModelName(rec.modelName) ||
                            rec.modelName ||
                            '?'
                          const rowInitials =
                            nameForInitials
                              .replace(/\.(gguf|GGUF)$/i, '')
                              .replace(/[^a-zA-Z0-9]/g, '')
                              .slice(0, 2) ||
                            hfAuthor.slice(0, 2) ||
                            '?'

                          const brandIconSrc = recommendedSetupModelIconSrc(
                            rec.modelName
                          )
                          const rowDownloadProgress = rowTrackId
                            ? downloadProcesses.find((p) => p.id === rowTrackId)
                            : undefined

                          return (
                            <div
                              key={`${rec.modelName}-${rec.descriptionKey}`}
                              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                {brandIconSrc ? (
                                  <img
                                    src={brandIconSrc}
                                    alt=""
                                    className="size-8 shrink-0 object-contain"
                                    draggable={false}
                                    aria-hidden
                                  />
                                ) : (
                                  <HuggingFaceAuthorAvatar
                                    author={hfAuthor}
                                    initials={rowInitials}
                                    className="size-8 shrink-0"
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <h2 className="truncate text-sm font-medium leading-tight">
                                    {model
                                      ? extractModelName(model.model_name)
                                      : extractModelName(rec.modelName)}
                                    {downloadSize ? (
                                      <span className="text-xs font-normal text-muted-foreground">
                                        {' '}
                                        · {downloadSize}
                                      </span>
                                    ) : null}
                                  </h2>
                                  <RecommendedModelChip
                                    className="mt-1 inline-flex max-w-full"
                                    variant={chipVariantForRecommendedDescriptionKey(
                                      rec.descriptionKey
                                    )}
                                    title={t(rec.descriptionKey)}
                                  >
                                    {t(rec.descriptionKey)}
                                  </RecommendedModelChip>
                                  {!model && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {sourcesLoading
                                        ? t('hub:loadingModels')
                                        : t('setup:modelUnavailable')}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <Button
                                  size="sm"
                                  disabled={
                                    !model ||
                                    !variant ||
                                    rowDownloading ||
                                    rowDownloaded
                                  }
                                  onClick={() => {
                                    if (!model || !variant) return
                                    captureRecommendedClick({
                                      modelId: variant.model_id,
                                      format: 'GINFER',
                                      sizeGb: sizeStringToGb(downloadSize),
                                      position: index,
                                    })
                                    startDownload(variant)
                                    enterChatForDownload(
                                      variant.model_id,
                                      LOCAL_LLAMACPP_PROVIDER
                                    )
                                  }}
                                  className="shrink-0 rounded-full px-4"
                                >
                                  {/* Reserve width for the widest possible label so the
                                  button doesn't reflow when its state flips between
                                  Download / Downloading… / Downloaded. */}
                                  <span className="grid">
                                    <span
                                      aria-hidden="true"
                                      className="invisible col-start-1 row-start-1"
                                    >
                                      {t('setup:downloading')}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className="invisible col-start-1 row-start-1"
                                    >
                                      {t('hub:downloaded')}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className="invisible col-start-1 row-start-1"
                                    >
                                      {t('hub:download')}
                                    </span>
                                    <span className="col-start-1 row-start-1">
                                      {rowDownloaded
                                        ? t('hub:downloaded')
                                        : rowDownloading
                                          ? t('setup:downloading')
                                          : t('hub:download')}
                                    </span>
                                  </span>
                                </Button>
                                {rowDownloading && rowTrackId ? (
                                  <p
                                    className="text-right text-xs text-muted-foreground tabular-nums"
                                    aria-live="polite"
                                  >
                                    {rowDownloadProgress &&
                                    rowDownloadProgress.total > 0
                                      ? `${Math.round((rowDownloadProgress.progress ?? 0) * 100)}% · ${formatDownloadGb(rowDownloadProgress.current)} / ${formatDownloadGb(rowDownloadProgress.total)} GB`
                                      : t('setup:downloadPreparing')}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* No Skip link: leaving empty-handed is handled by the
                    `MODEL_STEP_AUTO_EXIT_MS` timeout, so the screen offers only
                    the two ways to finish setup rather than a way to dodge it. */}
                <div className="relative z-60 flex shrink-0 flex-col items-center gap-3 pt-3">
                  {/* A user with no machine for local inference, or an existing
                      cloud subscription, would otherwise have nothing to pick.
                      The divider frames the two as alternatives rather than a
                      primary and an afterthought. */}
                  {hasCloudProviders && (
                    <>
                      <div className="flex w-full shrink-0 items-center gap-3">
                        <span className="bg-border h-px flex-1" />
                        <span className="text-muted-foreground text-xs">
                          {t('setup:orDivider')}
                        </span>
                        <span className="bg-border h-px flex-1" />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setCloudDialog(true)}
                        className="relative z-60 shrink-0 rounded-full px-4"
                      >
                        <Cloud />
                        {t('setup:cloudStep.trigger')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AddCloudProviderDialog
        open={cloudDialogOpen}
        onOpenChange={setCloudDialog}
        onKeySaved={enterChatWithCloudProvider}
      />
    </div>
  )
}

export default SetupScreen
