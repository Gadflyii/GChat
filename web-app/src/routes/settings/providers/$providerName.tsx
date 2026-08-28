/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { isOnboardingPending } from '@/lib/onboarding'
import { captureProviderKeyConfigured } from '@/lib/onboarding-telemetry'
import { buildApiKeyUpdate } from '@/lib/provider-api-key'
import { getProviderTitle, getModelDisplayName } from '@/lib/utils'
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Capabilities from '@/containers/Capabilities'
import {
  ModelSourceBadge,
  MissingModelBadge,
} from '@/components/ModelSourceBadge'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  isKeylessRemoteProvider,
  isLocalProvider,
  isLoopbackUrl,
  unregisterRemoteProvider,
} from '@/utils/registerRemoteProvider'
import { syncActiveModelsFromEngines } from '@/utils/activeModelsSync'
import {
  IconLoader,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import {
  isKnownProvider,
  useProviderRegistryStore,
} from '@/stores/provider-registry-store'
import { EMBEDDING_MODEL_ID } from '@/constants/models'
import { getModelCapabilities } from '@/lib/models'
import { useModelLoad } from '@/hooks/useModelLoad'
import { switchToModel } from '@/utils/switchModel'
import { useAppState } from '@/hooks/useAppState'
import { useShallow } from 'zustand/shallow'
import { DialogAddModel } from '@/containers/dialogs/AddModel'

// as route.threadsDetail
export const Route = createFileRoute('/settings/providers/$providerName')({
  component: ProviderDetail,
  validateSearch: (search: Record<string, unknown>): { step?: string } => {
    // validate and parse the search params into a typed state
    return {
      step: String(search?.step),
    }
  },
})

function ProviderDetail() {
  const { t } = useTranslation()
  const { providerName } = useParams({ from: Route.id })
  const serviceHub = useServiceHub()
  const { setModelLoadError } = useModelLoad()
  const [activeModels, setActiveModels] = useAppState(
    useShallow((state) => [state.activeModels, state.setActiveModels])
  )
  const [loadingModels, setLoadingModels] = useState<string[]>([])
  const [refreshingModels, setRefreshingModels] = useState(false)
  const navigate = useNavigate()
  const { getProviderByName, setProviders, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)

  const hasDownloadedModels =
    (provider?.models.filter((m) => m.id !== EMBEDDING_MODEL_ID).length ?? 0) >
    0

  useEffect(() => {
    // Refresh local-engine-backed active models when entering this provider's
    // settings screen. Cloud models live only in frontend state (the Local API
    // Server proxy tracks them via register_provider_config), so we must
    // preserve any cloud entries instead of blindly overwriting.
    if (provider?.provider) {
      serviceHub
        .models()
        .getActiveModels(provider.provider)
        .then((models) => syncActiveModelsFromEngines(models || []))
    }
  }, [serviceHub, provider?.provider])

  // Note: settingsChanged event is now handled globally in GlobalEventHandler
  // This ensures all screens receive the event intermediately

  // Auto-load models for loopback providers (Ollama, LM Studio, custom
  // self-hosted OpenAI-compatible servers, …). Their catalog is dynamic —
  // whatever the user runs locally — so we silently probe /v1/models instead
  // of forcing a manual Refresh. This fires both on entry (built-in Ollama,
  // whose loopback base_url comes from the registry) AND when the user edits a
  // custom provider's Base URL to a loopback address. Errors are non-fatal and
  // the manual Refresh button remains available.
  const loopbackBaseUrl =
    provider &&
    !isLocalProvider(provider.provider) &&
    provider.base_url &&
    isLoopbackUrl(provider.base_url)
      ? provider.base_url
      : null

  useEffect(() => {
    if (!loopbackBaseUrl) return

    let cancelled = false

    // Debounce: editing the Base URL field char-by-char must not spam the
    // endpoint. We fetch only after typing settles (and re-fetch cleanly if
    // the URL changes again, since the timer is cleared on cleanup).
    const timer = setTimeout(() => {
      const prov = useModelProvider.getState().getProviderByName(providerName)
      if (cancelled || !prov) return

      const load = async () => {
        setRefreshingModels(true)
        try {
          const liveIds = await serviceHub
            .providers()
            .fetchModelsFromProvider(prov)
          if (cancelled) return

          const existing = new Set(prov.models.map((m) => m.id))
          const newModels = liveIds
            .filter((id) => !existing.has(id))
            .map((id) => ({
              id,
              model: id,
              name: id,
              capabilities: getModelCapabilities(prov.provider, id),
              version: '1.0',
            }))

          if (newModels.length > 0) {
            updateProvider(prov.provider, {
              ...prov,
              models: [...prov.models, ...newModels],
            })
          }
        } catch (err) {
          console.warn(
            `[providers:${providerName}] auto model load failed (non-fatal):`,
            err
          )
        } finally {
          if (!cancelled) setRefreshingModels(false)
        }
      }

      void load()
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [providerName, loopbackBaseUrl, serviceHub, updateProvider])

  const handleRefreshModels = async () => {
    if (!provider) return

    setRefreshingModels(true)
    try {
      // Step 1 — Pull the latest manifest from our remote registry on GitHub
      // (the curated source for known cloud providers).
      try {
        await useProviderRegistryStore.getState().refresh({ force: true })
      } catch (err) {
        console.warn(
          `[providers:${provider.provider}] registry refresh failed:`,
          err
        )
      }

      const state = useProviderRegistryStore.getState()
      if (state.error) {
        toast.error(t('providers:models'), {
          description: state.error,
        })
        return
      }

      // Count models that will newly appear on this provider after the
      // registry merge — for the success toast.
      const fresh = await serviceHub.providers().getProviders()
      const registryProvider = fresh.find(
        (p) => p.provider === provider.provider
      )
      const existingIds = new Set(provider.models.map((m) => m.id))
      let newCount = registryProvider
        ? registryProvider.models.filter((m) => !existingIds.has(m.id)).length
        : 0

      // Step 2 — Hybrid: also query the provider's live /v1/models endpoint
      // (ATO-209). The registry only covers known cloud providers; custom /
      // self-hosted providers (vLLM, llama-server, LM Studio, etc.) are
      // invisible to the registry, so this is the only path that surfaces
      // their actual model list. We do it for all non-local providers that
      // have a base_url configured. Errors are non-fatal — if the live
      // endpoint is unavailable we still apply the registry results, but we
      // remember the error so the toast can warn instead of falsely claiming
      // "no new models" (ATO-210).
      //
      // P2 (ATO — registry-driven behavior): a registry provider may opt out
      // of live model listing via `supports_model_listing: false` (some clouds
      // expose hundreds of junk/internal IDs at /v1/models). When the flag is
      // explicitly false we show the curated registry list only and skip the
      // live probe. Missing/true keeps the hybrid behavior.
      let liveNewModels: Model[] = []
      let liveFetchError: Error | null = null
      const registrySupportsListing =
        registryProvider?.supports_model_listing !== false
      if (
        provider.base_url &&
        !isLocalProvider(provider.provider) &&
        registrySupportsListing
      ) {
        try {
          const liveModelIds = await serviceHub
            .providers()
            .fetchModelsFromProvider(provider)

          // Collect IDs already present after the registry pass so we only
          // add genuinely new entries.
          const afterRegistryIds = new Set([
            ...existingIds,
            ...(registryProvider?.models ?? []).map((m) => m.id),
          ])
          liveNewModels = liveModelIds
            .filter((id) => !afterRegistryIds.has(id))
            .map((id) => ({
              id,
              model: id,
              name: id,
              capabilities: getModelCapabilities(provider.provider, id),
              version: '1.0',
            }))

          if (liveNewModels.length > 0) newCount += liveNewModels.length

          console.info(
            `[providers:${provider.provider}] live /models: ${liveModelIds.length} total, ${liveNewModels.length} new`
          )
        } catch (liveErr) {
          // Non-fatal: registry results still apply even if the live
          // endpoint is unreachable or returns an error. We surface the error
          // in the toast below so the user knows the list may be incomplete.
          liveFetchError =
            liveErr instanceof Error ? liveErr : new Error(String(liveErr))
          console.warn(
            `[providers:${provider.provider}] live /models fetch failed (non-fatal):`,
            liveErr
          )
        }
      }

      // Apply the registry refresh. `setProviders` merges catalog updates while
      // preserving API keys, base URLs, and user-tweaked settings per provider,
      // and never removes existing models.
      setProviders(fresh)

      // Persist the live-discovered models onto THIS provider. We cannot inject
      // into `fresh` because custom / self-hosted providers (AIML, Cerebras,
      // LM Studio, vLLM, …) are NOT part of getProviders() output — they live
      // only in useModelProvider state, so the old `fresh.map()` injection
      // silently dropped them (toast said "Added N" but the list stayed empty).
      // updateProvider operates on current state and works for both registry
      // and custom providers.
      if (liveNewModels.length > 0) {
        const current =
          useModelProvider.getState().getProviderByName(provider.provider) ??
          provider
        // Dedupe by id (first-seen wins) so both newly fetched duplicates and
        // any duplicates already persisted from an earlier refresh collapse to
        // a single row.
        const byId = new Map<string, Model>()
        for (const m of [...current.models, ...liveNewModels]) {
          if (m.id && !byId.has(m.id)) byId.set(m.id, m)
        }
        updateProvider(provider.provider, { models: Array.from(byId.values()) })
      }

      if (newCount > 0) {
        toast.success(t('providers:models'), {
          description: t('providers:refreshModelsSuccess', {
            count: newCount,
            provider: provider.provider,
          }),
        })
      } else if (liveFetchError) {
        // Live fetch failed, so the "no new models" result may be incomplete —
        // warn with the underlying error instead of a misleading success.
        toast.warning(t('providers:models'), {
          description: t('providers:refreshModelsLiveFailed', {
            provider: provider.provider,
            error:
              liveFetchError.message ||
              t('providers:refreshModelsFailed', {
                provider: provider.provider,
              }),
          }),
        })
      } else {
        toast.success(t('providers:models'), {
          description: t('providers:noNewModels'),
        })
      }
    } catch (err) {
      console.error(`[providers:${provider.provider}] refresh failed:`, err)
      const detail =
        err instanceof Error && err.message
          ? err.message
          : t('providers:refreshModelsFailed', { provider: provider.provider })
      toast.error(t('providers:models'), {
        description: detail,
      })
    } finally {
      setRefreshingModels(false)
    }
  }

  const handleStartModel = async (modelId: string) => {
    if (!provider) return
    setLoadingModels((prev) => [...prev, modelId])
    try {
      // switchToModel stops all other models, starts this one, restarts the
      // server, and updates activeModels / loadingModel globally.
      await switchToModel({
        modelId,
        providerName: provider.provider,
        serviceHub,
      })
    } catch (error) {
      setModelLoadError(error as ErrorObject)
    } finally {
      setLoadingModels((prev) => prev.filter((id) => id !== modelId))
    }
  }

  const handleStopModel = async () => {
    if (!provider) return
    try {
      const isLocalEngine = isLocalProvider(provider.provider)
      if (isLocalEngine) {
        await serviceHub.models().stopAllModels()
      } else {
        // Cloud "stop": drop the proxy registration so incoming chat requests
        // for this provider's models stop being routed upstream. Local engines
        // are untouched; they can't be active for a cloud provider anyway.
        await unregisterRemoteProvider(provider.provider)
      }
      await window.core?.api?.stopServer()
      useAppState.getState().setServerStatus('stopped')
      if (isLocalEngine) {
        const models = await serviceHub
          .models()
          .getActiveModels(provider.provider)
        syncActiveModelsFromEngines(models || [])
      } else {
        // Remove any of this cloud provider's models from the active list
        // while leaving other providers' active entries intact.
        const providerModelIds = new Set(provider.models.map((m) => m.id))
        const remaining = useAppState
          .getState()
          .activeModels.filter((id) => !providerModelIds.has(id))
        setActiveModels(remaining)
      }
    } catch (error) {
      console.error('Error stopping model:', error)
    }
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <div className="flex items-center justify-between">
              <h1 className="font-medium text-base">
                {getProviderTitle(providerName)}
              </h1>
              <Switch
                checked={provider?.active ?? false}
                onCheckedChange={(checked) =>
                  provider && updateProvider(providerName, { active: checked })
                }
              />
            </div>

            <div className="flex flex-col gap-3">
              {/* Settings */}
              <Card>
                {provider?.settings.map((setting, settingIndex) => {
                  // Use the DynamicController component
                  const actionComponent = (
                    <div className="mt-2">
                      <DynamicControllerSetting
                        controllerType={setting.controller_type}
                        controllerProps={setting.controller_props}
                        onChange={(newValue) => {
                          if (provider) {
                            const newSettings = [...provider.settings]
                            // Handle different value types by forcing the type
                            // Use type assertion to bypass type checking

                            ;(
                              newSettings[settingIndex].controller_props as {
                                value: string | boolean | number
                              }
                            ).value = newValue

                            // Create update object with updated settings
                            const updateObj: Partial<ModelProvider> = {
                              settings: newSettings,
                            }
                            // Check if this is an API key or base URL setting and update the corresponding top-level field
                            const settingKey = setting.key
                            if (
                              settingKey === 'api-key' &&
                              typeof newValue === 'string'
                            ) {
                              // Single-sourced with onboarding's cloud dialog
                              // so the two cannot drift on what writing a key
                              // means (settings entry + top-level mirror).
                              Object.assign(
                                updateObj,
                                buildApiKeyUpdate(provider, newValue)
                              )
                              // Configuring a key satisfies the onboarding
                              // gate, so this is a real exit from the flow
                              // that previously bypassed all telemetry.
                              // Only the presence of a key is reported —
                              // never the key itself.
                              if (newValue.length > 0) {
                                captureProviderKeyConfigured({
                                  provider: provider.provider,
                                  duringOnboarding: isOnboardingPending(
                                    useModelProvider.getState().providers
                                  ),
                                })
                              }
                            } else if (
                              settingKey === 'base-url' &&
                              typeof newValue === 'string'
                            ) {
                              // Trim so a stray leading/trailing space (common
                              // on paste) doesn't leak into request URLs as
                              // `/v1 /models` → 404. Normalise the stored
                              // setting value too, not just the mirror field.
                              const trimmedUrl = newValue.trim()
                              ;(
                                newSettings[settingIndex]
                                  .controller_props as {
                                  value: string | boolean | number
                                }
                              ).value = trimmedUrl
                              updateObj.base_url = trimmedUrl
                            }

                            updateProvider(providerName, {
                              ...provider,
                              ...updateObj,
                            })

                            serviceHub
                              .providers()
                              .updateSettings(
                                providerName,
                                updateObj.settings ?? []
                              )
                            serviceHub.models().stopAllModels()

                            // Refresh active models after stopping. Use
                            // the shared helper so cloud models tracked
                            // only in UI state aren't wiped.
                            serviceHub
                              .models()
                              .getActiveModels()
                              .then((models) =>
                                syncActiveModelsFromEngines(models || [])
                              )
                          }
                        }}
                      />
                    </div>
                  )

                  return (
                    <CardItem
                      key={settingIndex}
                      title={setting.title}
                      column={
                        setting.controller_type === 'input' &&
                        setting.controller_props.type !== 'number'
                          ? true
                          : false
                      }
                      description={
                        <RenderMarkdown
                          className="![>p]:text-muted-foreground select-none"
                          content={setting.description}
                          components={{
                            // Make links open in a new tab with the active
                            // Sectile brand accent.
                            a: ({ style, ...props }) => {
                              return (
                                <a
                                  {...props}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: 'var(--primary)', ...style }}
                                />
                              )
                            },
                            p: ({ ...props }) => (
                              <p {...props} className="mb-0!" />
                            ),
                          }}
                        />
                      }
                      actions={actionComponent}
                    />
                  )
                })}

                <DeleteProvider provider={provider} />
              </Card>

              {/* Models */}
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-foreground font-medium text-base">
                      {t('providers:models')}
                    </h1>
                    <div className="flex items-center gap-2">
                      {provider &&
                        !isLocalProvider(provider.provider) && (
                          <>
                            <Button
                              variant="secondary"
                              size="icon-xs"
                              onClick={handleRefreshModels}
                              disabled={refreshingModels}
                            >
                              {refreshingModels ? (
                                <IconLoader
                                  size={18}
                                  className="text-muted-foreground animate-spin"
                                />
                              ) : (
                                <IconRefresh
                                  size={18}
                                  className="text-muted-foreground"
                                />
                              )}
                            </Button>
                            <DialogAddModel provider={provider} />
                          </>
                        )}
                      {provider &&
                        isLocalProvider(provider.provider) &&
                        !hasDownloadedModels && (
                          <Button
                            variant="default"
                            size="sm"
                            className="min-w-[8rem] justify-center"
                            onClick={() => navigate({ to: route.hub.index })}
                          >
                            <IconSearch size={18} />
                            <span>{t('providers:findModel')}</span>
                          </Button>
                        )}
                    </div>
                  </div>
                }
              >
                {provider?.models.filter((m) => m.id !== EMBEDDING_MODEL_ID)
                  .length ? (
                  provider?.models
                    .filter((m) => m.id !== EMBEDDING_MODEL_ID)
                    .map((model, modelIndex) => {
                      const capabilities = model.capabilities || []
                      return (
                        <CardItem
                          key={modelIndex}
                          title={
                            <div className="flex items-center gap-2">
                              <h1
                                className="font-medium line-clamp-1 max-w-[16rem] lg:max-w-[24rem] xl:max-w-none"
                                title={model.id}
                              >
                                {getModelDisplayName(model)}
                              </h1>
                              {model.source && (
                                <ModelSourceBadge source={model.source} />
                              )}
                              {model.missing && (
                                <MissingModelBadge source={model.source} />
                              )}
                              <Capabilities capabilities={capabilities} />
                            </div>
                          }
                          actions={
                            <div className="flex items-center gap-0.5">
                              {(() => {
                                // Favorite star sits on the far left of the
                                // action row, before the edit icon. The slot
                                // is always reserved so that toggling
                                // visibility (e.g. after entering an API key
                                // for a predefined cloud provider) doesn't
                                // shift the surrounding icons. For custom
                                // providers the star is always visible; for
                                // predefined providers it's only visible once
                                // an API key has been set.
                                if (!provider) return null
                                const isPredefined = isKnownProvider(
                                  provider.provider
                                )
                                const showFavorite =
                                  !isPredefined ||
                                  Boolean(provider.api_key?.length)
                                return (
                                  <div
                                    aria-hidden={!showFavorite}
                                    className={
                                      showFavorite
                                        ? undefined
                                        : 'invisible pointer-events-none'
                                    }
                                  >
                                    <FavoriteModelAction model={model} />
                                  </div>
                                )
                              })()}
                              <DialogEditModel
                                provider={provider}
                                modelId={model.id}
                              />
                              {model.settings && (
                                <ModelSetting
                                  provider={provider}
                                  model={model}
                                />
                              )}
                              <DialogDeleteModel
                                provider={provider}
                                modelId={model.id}
                              />
                              {provider &&
                                (() => {
                                  // Cloud providers need an API key before
                                  // they can be "started" (registered with the
                                  // proxy). Local engines don't.
                                  const needsApiKey =
                                    !isLocalProvider(provider.provider) &&
                                    !provider.api_key &&
                                    !isKeylessRemoteProvider(provider)
                                  const isActive = activeModels.some(
                                    (activeModel) => activeModel === model.id
                                  )
                                  const isLoading = loadingModels.includes(
                                    model.id
                                  )

                                  if (isActive) {
                                    return (
                                      <div className="ml-2">
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => handleStopModel()}
                                        >
                                          {t('providers:stop')}
                                        </Button>
                                      </div>
                                    )
                                  }

                                  const startButton = (
                                    <Button
                                      size="sm"
                                      disabled={isLoading || needsApiKey}
                                      onClick={() => handleStartModel(model.id)}
                                    >
                                      {isLoading ? (
                                        <div className="flex items-center gap-2">
                                          <IconLoader
                                            size={16}
                                            className="animate-spin"
                                          />
                                        </div>
                                      ) : (
                                        t('providers:start')
                                      )}
                                    </Button>
                                  )

                                  return (
                                    <div className="ml-2">
                                      {needsApiKey ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span>{startButton}</span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            Add API key first
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : (
                                        startButton
                                      )}
                                    </div>
                                  )
                                })()}
                            </div>
                          }
                        />
                      )
                    })
                ) : (
                  <div className="-mt-2">
                    <div className="flex items-center gap-2">
                      <h6 className="font-medium text-base">
                        {t('providers:noModelFound')}
                      </h6>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {t('providers:noModelFoundDesc')}
                      &nbsp;
                      <Link to={route.hub.index}>{t('common:hub')}</Link>
                    </p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
