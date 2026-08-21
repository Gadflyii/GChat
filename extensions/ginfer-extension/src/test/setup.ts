import { vi } from 'vitest'

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

// Mock the global window object for Tauri
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStorageMock,
    core: {
      api: {},
      extensionManager: {
        getByName: vi.fn().mockReturnValue({
          downloadFiles: vi.fn().mockResolvedValue(undefined),
          cancelDownload: vi.fn().mockResolvedValue(undefined),
        }),
      },
    },
  },
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class {},
}))
