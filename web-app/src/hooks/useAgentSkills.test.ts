import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentSkill,
  deleteAgentSkill,
  exportAgentSkill,
  getAgentSkill,
  importAgentSkill,
  listAgentSkills,
  refreshAgentSkills,
  setAgentSkillEnabled,
  updateAgentSkill,
  type AgentSkillDetail,
} from '@/services/agent/skills'
import type { DialogService } from '@/services/dialog/types'
import { seedServiceHub } from '@/test/service-hub'
import { useAgentSkills } from './useAgentSkills'

vi.mock('@/services/agent/skills', () => ({
  createAgentSkill: vi.fn(),
  deleteAgentSkill: vi.fn(),
  exportAgentSkill: vi.fn(),
  getAgentSkill: vi.fn(),
  importAgentSkill: vi.fn(),
  listAgentSkills: vi.fn(),
  refreshAgentSkills: vi.fn(),
  setAgentSkillEnabled: vi.fn(),
  updateAgentSkill: vi.fn(),
}))

const saveDialog = vi.hoisted(() => vi.fn())

const skill = {
  name: 'custom-skill',
  description: 'Custom',
  version: '1.0.0',
  requiresTools: [],
  requiresScripts: [],
  dangerous: false,
  platforms: null,
  enabled: true,
  compatible: true,
  reserved: false,
  unavailableReasons: [],
  error: null,
}

const alpha = { ...skill, name: 'alpha', body: '# Alpha' }
const beta = { ...skill, name: 'beta', body: '# Beta' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function mockSelectionSkills() {
  vi.mocked(listAgentSkills).mockResolvedValue([alpha, beta])
  vi.mocked(refreshAgentSkills).mockResolvedValue([alpha, beta])
  vi.mocked(getAgentSkill).mockImplementation(async (name) =>
    name === alpha.name ? alpha : beta
  )
}

describe('useAgentSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedServiceHub({
      dialog: {
        save: saveDialog,
      } as DialogService,
    })
    vi.mocked(listAgentSkills).mockResolvedValue([skill])
    vi.mocked(refreshAgentSkills).mockResolvedValue([skill])
    vi.mocked(getAgentSkill).mockResolvedValue({ ...skill, body: '# Body' })
    vi.mocked(createAgentSkill).mockResolvedValue({ ...skill, body: '# Body' })
    vi.mocked(importAgentSkill).mockResolvedValue({ ...skill, body: '# Body' })
    vi.mocked(setAgentSkillEnabled).mockResolvedValue()
    vi.mocked(deleteAgentSkill).mockResolvedValue()
    vi.mocked(exportAgentSkill).mockResolvedValue()
    vi.mocked(updateAgentSkill).mockResolvedValue({ ...skill, body: '# Body' })
    saveDialog.mockReset()
  })

  it('selects the first skill alphabetically after loading', async () => {
    const alpha = { ...skill, name: 'alpha' }
    const zulu = { ...skill, name: 'zulu' }
    vi.mocked(listAgentSkills).mockResolvedValue([zulu, alpha])
    vi.mocked(getAgentSkill).mockImplementation(async (name) => ({
      ...(name === 'alpha' ? alpha : zulu),
      body: '# Body',
    }))

    const { result } = renderHook(() => useAgentSkills())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.skills.map(({ name }) => name)).toEqual([
      'alpha',
      'zulu',
    ])
    expect(result.current.selected?.name).toBe('alpha')
  })

  it('creates and imports a skill, then selects it', async () => {
    const { result } = renderHook(() => useAgentSkills())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const request = {
      name: skill.name,
      description: skill.description,
      instructions: '# Body',
    }
    await act(() => result.current.addCreated(request))
    expect(createAgentSkill).toHaveBeenCalledWith(request)
    expect(result.current.selected?.name).toBe(skill.name)

    await act(() => result.current.addImported('/tmp/custom-skill'))
    expect(importAgentSkill).toHaveBeenCalledWith('/tmp/custom-skill')
    expect(result.current.selected?.name).toBe(skill.name)
  })

  it('loads, selects, enables, and selects the next skill after deletion', async () => {
    const nextSkill = { ...skill, name: 'next-skill' }
    vi.mocked(listAgentSkills)
      .mockResolvedValueOnce([skill, nextSkill])
      .mockResolvedValueOnce([skill, nextSkill])
      .mockResolvedValueOnce([nextSkill])
    vi.mocked(getAgentSkill).mockImplementation(async (name) => ({
      ...(name === skill.name ? skill : nextSkill),
      body: '# Body',
    }))
    const { result } = renderHook(() => useAgentSkills())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.select(skill.name))
    expect(result.current.selected?.body).toBe('# Body')

    await act(() => result.current.setEnabled(skill.name, false))
    expect(setAgentSkillEnabled).toHaveBeenCalledWith(skill.name, false)

    await act(() => result.current.remove(skill.name))
    expect(deleteAgentSkill).toHaveBeenCalledWith(skill.name)
    expect(result.current.selected?.name).toBe(nextSkill.name)
  })

  it('reloads the selected skill detail during refresh', async () => {
    const { result } = renderHook(() => useAgentSkills())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.select(skill.name))

    vi.mocked(getAgentSkill).mockResolvedValue({
      ...skill,
      enabled: false,
      body: '# Updated body',
    })
    await act(() => result.current.load(true))

    expect(result.current.selected).toMatchObject({
      enabled: false,
      body: '# Updated body',
    })
  })

  it('keeps the latest selection when earlier detail requests finish later', async () => {
    mockSelectionSkills()
    const { result } = renderHook(() => useAgentSkills())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const first = deferred<AgentSkillDetail>()
    const second = deferred<AgentSkillDetail>()
    vi.mocked(getAgentSkill)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    let selectingAlpha!: Promise<AgentSkillDetail | undefined>
    let selectingBeta!: Promise<AgentSkillDetail | undefined>
    act(() => {
      selectingAlpha = result.current.select(alpha.name)
      selectingBeta = result.current.select(beta.name)
    })

    await act(async () => {
      second.resolve(beta)
      expect(await selectingBeta).toEqual(beta)
    })
    expect(result.current.selected).toEqual(beta)
    expect(result.current.error).toBeNull()
    await act(async () => {
      first.resolve(alpha)
      expect(await selectingAlpha).toBeUndefined()
    })
    expect(result.current.selected).toEqual(beta)
    expect(result.current.error).toBeNull()

    await act(() => result.current.load(true))
    expect(getAgentSkill).toHaveBeenLastCalledWith(beta.name)
    expect(result.current.selected).toEqual(beta)
  })

  it('does not replace the current selection error with an obsolete rejection', async () => {
    mockSelectionSkills()
    const { result } = renderHook(() => useAgentSkills())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const obsolete = deferred<AgentSkillDetail>()
    vi.mocked(getAgentSkill).mockReturnValueOnce(obsolete.promise)
    let selectingAlpha!: Promise<AgentSkillDetail | undefined>
    act(() => {
      selectingAlpha = result.current.select(alpha.name)
    })

    await act(() => result.current.select(beta.name))
    expect(result.current.selected).toEqual(beta)
    expect(result.current.error).toBeNull()
    vi.mocked(getAgentSkill).mockRejectedValueOnce(
      new Error('Current beta detail denied')
    )
    await act(() => result.current.select(beta.name))
    expect(result.current.error).toBe('Error: Current beta detail denied')

    await act(async () => {
      obsolete.reject(new Error('Obsolete alpha detail denied'))
      await selectingAlpha
    })
    expect(result.current.selected).toEqual(beta)
    expect(result.current.error).toBe('Error: Current beta detail denied')
  })

  it.each(['initial', 'refresh'] as const)(
    'does not overwrite a newer selection with a pending %s detail read',
    async (phase) => {
      mockSelectionSkills()
      const pending = deferred<AgentSkillDetail>()
      if (phase === 'initial') {
        vi.mocked(getAgentSkill).mockReturnValueOnce(pending.promise)
      }
      const { result } = renderHook(() => useAgentSkills())
      let refreshing: Promise<void> | undefined
      if (phase === 'refresh') {
        await waitFor(() => expect(result.current.loading).toBe(false))
        vi.mocked(getAgentSkill).mockReturnValueOnce(pending.promise)
        act(() => {
          refreshing = result.current.load(true)
        })
      }
      await waitFor(() => {
        expect(getAgentSkill).toHaveBeenCalledTimes(phase === 'initial' ? 1 : 2)
        expect(getAgentSkill).toHaveBeenLastCalledWith(alpha.name)
      })
      await act(() => result.current.select(beta.name))
      expect(result.current.selected).toEqual(beta)

      await act(async () => {
        pending.resolve({ ...alpha, body: '# Obsolete alpha detail' })
        if (refreshing) await refreshing
        else await pending.promise
      })
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selected).toEqual(beta)
      expect(result.current.error).toBeNull()
      expect(result.current.skills.map(({ name }) => name)).toEqual([
        'alpha',
        'beta',
      ])
    }
  )

  it('does not reselect a skill whose enable operation finishes after another selection', async () => {
    mockSelectionSkills()
    const { result } = renderHook(() => useAgentSkills())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const enabling = deferred<void>()
    vi.mocked(setAgentSkillEnabled).mockReturnValueOnce(enabling.promise)
    vi.mocked(listAgentSkills).mockResolvedValueOnce([
      { ...alpha, enabled: false },
      beta,
    ])
    let toggling!: Promise<void>
    act(() => {
      toggling = result.current.setEnabled(alpha.name, false)
    })
    await act(() => result.current.select(beta.name))
    expect(result.current.selected).toEqual(beta)

    await act(async () => {
      enabling.resolve()
      await toggling
    })
    expect(setAgentSkillEnabled).toHaveBeenCalledWith(alpha.name, false)
    expect(result.current.skills).toEqual([{ ...alpha, enabled: false }, beta])
    expect(result.current.selected).toEqual(beta)
    expect(result.current.error).toBeNull()
  })

  it('updates and exports a skill through the save dialog', async () => {
    const updated = {
      ...skill,
      description: 'Updated',
      body: '# Updated body',
    }
    vi.mocked(updateAgentSkill).mockResolvedValue(updated)
    saveDialog.mockResolvedValue('/tmp/custom-skill.skill')
    const { result } = renderHook(() => useAgentSkills())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() =>
      result.current.update({
        name: skill.name,
        description: 'Updated',
        instructions: '# Updated body',
      })
    )
    expect(result.current.selected).toEqual(updated)

    let exported = false
    await act(async () => {
      exported = await result.current.exportSkill(skill.name)
    })
    expect(exported).toBe(true)
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: 'custom-skill.skill',
      filters: [{ name: 'GChat Skill', extensions: ['skill'] }],
    })
    expect(exportAgentSkill).toHaveBeenCalledWith(
      skill.name,
      '/tmp/custom-skill.skill'
    )
  })
})
