import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { syntaxGrammarAssets } from './scripts/syntax-grammar-assets'
import tauriConfig from '../src-tauri/tauri.conf.json'
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      syntaxGrammarAssets(),
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.((test).ts)|test-page',
      }),
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['path'],
        globals: {
          Buffer: false,
          global: false,
          process: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@gchat/core': path.resolve(__dirname, '../core/src/index.ts'),
        '@gchat/conversational-extension': path.resolve(__dirname, '../extensions/conversational-extension/src/index.ts'),
      },
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI),
      IS_DEV: JSON.stringify(process.env.IS_DEV),
      IS_WEB_APP: JSON.stringify(false),
      IS_MACOS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('darwin') ?? false
      ),
      IS_WINDOWS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('windows') ?? false
      ),
      IS_LINUX: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('linux') ?? false
      ),
      IS_IOS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('ios') ?? false
      ),
      IS_ANDROID: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('android') ?? false
      ),
      PLATFORM: JSON.stringify(process.env.TAURI_ENV_PLATFORM),

      VERSION: JSON.stringify(tauriConfig.version),

      AUTO_UPDATER_DISABLED: JSON.stringify(
        env.AUTO_UPDATER_DISABLED === 'true'
      ),
      FORCE_ONBOARDING: JSON.stringify(
        process.env.FORCE_ONBOARDING === 'true' ||
          env.FORCE_ONBOARDING === 'true'
      ),
      // Dev-only (`make dev-fresh`): wipes webview localStorage once per app
      // launch to exercise onboarding. Disabled in shipped builds.
      FRESH_INSTALL: JSON.stringify(
        process.env.FRESH_INSTALL === 'true' || env.FRESH_INSTALL === 'true'
      ),
      // Dev-only: pins the onboarding hardware tier so the low-spec
      // recommendations can be reviewed on a machine that is not low-spec.
      // '' in every shipped build, which leaves detection untouched.
      FORCE_HARDWARE_TIER: JSON.stringify(
        process.env.FORCE_HARDWARE_TIER ?? env.FORCE_HARDWARE_TIER ?? ''
      ),
      UPDATE_CHECK_INTERVAL_MS: JSON.stringify(
        Number(env.UPDATE_CHECK_INTERVAL_MS) || 60 * 60 * 1000
      ),
    },

    build: {
      sourcemap: false,
      manifest: true,
      rollupOptions: {
        output: {
          // These are shared semantic runtimes, not size-based fragments.
          // Explicit ownership keeps route/app modules in their natural chunks.
          onlyExplicitManualChunks: true,
          manualChunks(id) {
            if (id === '\0commonjsHelpers.js') return 'module-runtime'
            if (!id.includes('/node_modules/')) return
            const packagePath = id.split('/node_modules/').pop()!
            const packageName = packagePath.startsWith('@')
              ? packagePath.split('/').slice(0, 2).join('/')
              : packagePath.split('/')[0]
            if (['react', 'react-dom', 'scheduler'].includes(packageName)) return 'react-runtime'
            if (packageName.startsWith('@tanstack/') && packageName.includes('router')) return 'routing'
            // Mermaid owns a distinct installed KaTeX version. Keeping it
            // separate also keeps diagram-only math out of startup.
            if (packageName === 'katex') return id.includes('/mermaid/node_modules/') ? 'diagram-math' : 'math'
            if (packageName.startsWith('@tauri-apps/')) return 'desktop-api'
            if (['tailwind-merge', 'clsx', 'class-variance-authority'].includes(packageName)) return 'style-runtime'
            if (packageName === 'shiki' && packagePath.endsWith('/dist/langs.mjs')) return 'syntax-catalog'
            if (packageName.startsWith('unist-util-') || ['vfile', 'vfile-message'].includes(packageName)) return 'syntax-tree'
            if (packageName.startsWith('hast-util-') || ['parse5', 'entities', 'property-information', 'hastscript', 'comma-separated-tokens', 'space-separated-tokens', 'html-void-elements', 'web-namespaces', 'style-to-object', 'style-to-js'].includes(packageName)) return 'html-parser'
            if (packageName.startsWith('@radix-ui/') || packageName.startsWith('@floating-ui/') || ['sonner', 'cmdk'].includes(packageName)) return 'ui-primitives'
            if (['framer-motion', 'motion-dom', 'motion-utils'].includes(packageName)) return 'animation'
            if (packageName.startsWith('@dnd-kit/')) return 'drag-drop'
            if (['streamdown', 'react-markdown', 'unified', 'vfile', 'vfile-message', 'parse5', 'entities', 'property-information'].includes(packageName) || /^(remark|rehype|micromark|mdast-util|hast-util|unist-util)-/.test(packageName)) return 'markdown'
          },
        },
      },
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
        usePolling: true
      },
    },
  }
})
