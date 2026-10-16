import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { gbotControlOwner } from '../gbot'

const key = 'gbot-control-owner'

beforeEach(() => {
  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
})

it('migrates the current session owner and retains it after a fresh app session', async () => {
  sessionStorage.setItem(key, 'retained-human-owner')
  const generate = vi.spyOn(crypto, 'randomUUID')

  expect(gbotControlOwner()).toBe('retained-human-owner')
  expect(localStorage.getItem(key)).toBe('retained-human-owner')

  sessionStorage.clear()
  vi.resetModules()
  const reopened = await import('../gbot')
  expect(reopened.gbotControlOwner()).toBe('retained-human-owner')
  expect(sessionStorage.getItem(key)).toBe('retained-human-owner')
  expect(generate).not.toHaveBeenCalled()
})

it('durably creates a new owner and reuses it after a fresh app session', async () => {
  const owner = '7721934b-d2e1-470a-89bf-2bb4518ecffe'
  const generate = vi.spyOn(crypto, 'randomUUID').mockReturnValue(owner)

  expect(gbotControlOwner()).toBe(owner)
  expect(localStorage.getItem(key)).toBe(owner)

  sessionStorage.clear()
  vi.resetModules()
  const reopened = await import('../gbot')
  expect(reopened.gbotControlOwner()).toBe(owner)
  expect(generate).toHaveBeenCalledTimes(1)
})

it('keeps the durable owner when another app session has a different transient owner', () => {
  localStorage.setItem(key, 'durable-owner')
  sessionStorage.setItem(key, 'different-transient-owner')

  expect(gbotControlOwner()).toBe('durable-owner')
  expect(localStorage.getItem(key)).toBe('durable-owner')
  expect(sessionStorage.getItem(key)).toBe('durable-owner')
})

it.each(['durable', 'legacy'] as const)(
  'fails closed when the %s owner cannot be read',
  (store) => {
    sessionStorage.setItem(key, 'retained-human-owner')
    const getItem = Storage.prototype.getItem
    const denied = store === 'durable' ? localStorage : sessionStorage
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      name: string
    ) {
      if (this === denied && name === key) throw new Error('Storage unavailable')
      return getItem.call(this, name)
    })
    const generate = vi.spyOn(crypto, 'randomUUID')

    expect(() => gbotControlOwner()).toThrow('Storage unavailable')
    expect(generate).not.toHaveBeenCalled()
    expect(getItem.call(localStorage, key)).toBeNull()
    expect(getItem.call(sessionStorage, key)).toBe('retained-human-owner')
  }
)

it('does not grant a transient owner when migration cannot persist, and retries the retained owner', () => {
  sessionStorage.setItem(key, 'retained-human-owner')
  const setItem = Storage.prototype.setItem
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, name: string, value: string) {
      if (this === localStorage && name === key) throw new Error('Storage full')
      return setItem.call(this, name, value)
    })

  expect(() => gbotControlOwner()).toThrow('Storage full')
  expect(localStorage.getItem(key)).toBeNull()
  expect(sessionStorage.getItem(key)).toBe('retained-human-owner')

  write.mockRestore()
  expect(gbotControlOwner()).toBe('retained-human-owner')
  expect(localStorage.getItem(key)).toBe('retained-human-owner')
})

it('does not publish a newly generated owner when durable persistence fails', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage full')
  })

  expect(() => gbotControlOwner()).toThrow('Storage full')
  expect(localStorage.getItem(key)).toBeNull()
  expect(sessionStorage.getItem(key)).toBeNull()
})

it('uses the durable owner when the optional session mirror is unavailable', () => {
  localStorage.setItem(key, 'durable-owner')
  const getItem = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
    this: Storage,
    name: string
  ) {
    if (this === sessionStorage) throw new Error('Session unavailable')
    return getItem.call(this, name)
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Session unavailable')
  })

  expect(gbotControlOwner()).toBe('durable-owner')
})
