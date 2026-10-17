import { joinPath } from '@gchat/core'
import { fs } from '@gchat/core'

export async function defaultBinaryPath(
  dataFolderPath: string
): Promise<string> {
  const exe = IS_WINDOWS ? 'ginfer-serve.exe' : 'ginfer-serve'
  return joinPath(IS_LINUX
    ? [dataFolderPath, 'ginfer', 'linux', 'sm120a', 'bin', exe]
    : [dataFolderPath, 'ginfer', 'bin', exe])
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

/** The Host command leads a typed failure with `[code] `; keep the message plain and expose the code as `error.code`. */
export function loadFailure(modelLabel: string, error: unknown): Error {
  const raw = error && typeof (error as Error).message === 'string' ? (error as Error).message : String(error)
  const typed = /^\[([a-z_]+)\] ([\s\S]*)$/.exec(raw)
  const failure = new Error(`Failed to load ${modelLabel}: ${typed ? typed[2] : raw}`)
  if (typed) (failure as Error & { code?: string }).code = typed[1]
  return failure
}
