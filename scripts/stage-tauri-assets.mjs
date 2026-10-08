import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function stageTauriAssets(root) {
  const source = path.join(root, 'pre-install')
  const resources = path.join(root, 'src-tauri', 'resources')
  const destination = path.join(resources, 'pre-install')
  const archives = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tgz'))
    .map((entry) => entry.name)
    .sort()

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const name of archives) {
    copyFileSync(path.join(source, name), path.join(destination, name))
  }
  copyFileSync(path.join(root, 'LICENSE'), path.join(resources, 'LICENSE'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  stageTauriAssets(fileURLToPath(new URL('..', import.meta.url)))
}
