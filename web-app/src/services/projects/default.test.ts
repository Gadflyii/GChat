import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { DefaultProjectsService } from './default'
import type { ThreadFolder } from './types'

const storageKey = localStorageKey.threadManagement
const existingProjects: ThreadFolder[] = [
  { id: 'first-project', name: 'First project', updated_at: 100 },
  {
    id: 'second-project',
    name: 'Second project',
    updated_at: 200,
    assistantId: 'existing-assistant',
  },
]
const replacementProjects: ThreadFolder[] = [
  { id: 'replacement-project', name: 'Replacement project', updated_at: 300 },
]

beforeEach(() => {
  localStorage.removeItem(storageKey)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(storageKey)
})

describe('DefaultProjectsService persistence', () => {
  it('persists a created project for a new service instance', async () => {
    const service = new DefaultProjectsService()

    const created = await service.addProject('New project', 'new-assistant')

    expect(created).toEqual({
      id: expect.any(String),
      name: 'New project',
      updated_at: expect.any(Number),
      assistantId: 'new-assistant',
    })
    const reopened = new DefaultProjectsService()
    expect(await reopened.getProjects()).toEqual([created])
    expect(await reopened.getProjectById(created.id)).toEqual(created)
  })

  it.each([
    {
      operation: 'create',
      save: (service: DefaultProjectsService) =>
        service.addProject('Created project', 'new-assistant'),
      expected: [
        ...existingProjects,
        {
          id: expect.any(String),
          name: 'Created project',
          updated_at: expect.any(Number),
          assistantId: 'new-assistant',
        },
      ],
    },
    {
      operation: 'update',
      save: (service: DefaultProjectsService) =>
        service.updateProject('first-project', 'Updated project', 'new-assistant'),
      expected: [
        {
          ...existingProjects[0],
          name: 'Updated project',
          updated_at: expect.any(Number),
          assistantId: 'new-assistant',
        },
        existingProjects[1],
      ],
    },
    {
      operation: 'delete',
      save: (service: DefaultProjectsService) =>
        service.deleteProject('first-project'),
      expected: [existingProjects[1]],
    },
    {
      operation: 'setProjects',
      save: (service: DefaultProjectsService) =>
        service.setProjects(replacementProjects),
      expected: replacementProjects,
    },
  ])(
    'rejects $operation on quota failure, preserves prior projects, and allows retry',
    async ({ save, expected }) => {
      const service = new DefaultProjectsService()
      await service.setProjects(existingProjects)
      const persistedBeforeFailure = localStorage.getItem(storageKey)
      const quotaError = new DOMException(
        'Storage quota exceeded',
        'QuotaExceededError'
      )
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const setItem = Storage.prototype.setItem
      const write = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(function (this: Storage, name: string, value: string) {
          if (this === localStorage && name === storageKey) throw quotaError
          return setItem.call(this, name, value)
        })

      await expect(save(service)).rejects.toBe(quotaError)
      expect(localStorage.getItem(storageKey)).toBe(persistedBeforeFailure)
      expect(await new DefaultProjectsService().getProjects()).toEqual(
        existingProjects
      )

      write.mockRestore()
      await save(service)

      expect(localStorage.getItem(storageKey)).not.toBe(persistedBeforeFailure)
      expect(await new DefaultProjectsService().getProjects()).toEqual(expected)
    }
  )
})
