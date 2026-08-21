import { joinPath } from '@janhq/core'
import { fs } from '@janhq/core'

export async function defaultBinaryPath(
  dataFolderPath: string
): Promise<string> {
  const exe = IS_WINDOWS ? 'ginfer-serve.exe' : 'ginfer-serve'
  return joinPath([dataFolderPath, 'ginfer', 'bin', exe])
}

export async function resolveBinaryPath(
  dataFolderPath: string,
  configured: string | undefined
): Promise<string> {
  if (configured && configured.trim().length > 0) {
    const path = configured.trim()
    if (await fs.existsSync(path)) return path
    throw new Error(
      `ginfer-serve binary not found at configured path: ${path}. Fix Settings → GInfer → ginfer-serve Binary or delete the value to use the default location.`
    )
  }
  const fallback = await defaultBinaryPath(dataFolderPath)
  if (await fs.existsSync(fallback)) return fallback
  throw new Error(
    `ginfer-serve binary not found at ${fallback}. Set Settings → GInfer → ginfer-serve Binary, or download the binary into ${fallback}.`
  )
}

export function randomApiKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
