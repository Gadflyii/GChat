export type GChatDeepLinkTarget = {
  provider: 'huggingface'
  repo: string
  modelId: string
}

export function parseGChatDeepLink(
  deeplink: string
): GChatDeepLinkTarget | null {
  try {
    const url = new URL(deeplink)

    if (url.protocol !== 'gchat:' || url.host !== 'models') {
      return null
    }

    const pathSegments = url.pathname.split('/').filter(Boolean)
    if (pathSegments[0] !== 'huggingface') {
      return null
    }

    const repoSegments = pathSegments.slice(1)
    if (repoSegments.length < 2) {
      return null
    }

    const repo = repoSegments.join('/')

    return {
      provider: 'huggingface',
      repo,
      modelId: repo,
    }
  } catch {
    return null
  }
}
