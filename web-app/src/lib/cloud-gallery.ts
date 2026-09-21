import { isLocalProvider, isLoopbackUrl } from '@/utils/registerRemoteProvider'

// Azure also requires an account-specific endpoint.
const KEY_ONLY_UNSUPPORTED = new Set(['azure'])

// Preserve store order; only stored providers can accept key updates.
export function selectCloudGalleryProviders(
  providers: ModelProvider[]
): ModelProvider[] {
  return providers.filter(
    (p) =>
      !isLocalProvider(p.provider) &&
      !isLoopbackUrl(p.base_url) &&
      !p.persist &&
      !KEY_ONLY_UNSUPPORTED.has(p.provider) &&
      p.settings?.some((s) => s.key === 'api-key')
  )
}
