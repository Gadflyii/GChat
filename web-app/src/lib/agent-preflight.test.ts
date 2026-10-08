import { expect, it } from 'vitest'
import { roleReadiness } from './agent-preflight'
import type { AgentRoleAssignment } from '@/types/agent'

const assignment: AgentRoleAssignment = {
  target: { kind: 'pool', id: 'pool' },
  vision: true,
  minimumContext: 8192,
}
const catalog = {
  instances: [
    {
      id: 'lan',
      modelId: 'Qwen',
      port: null,
      vision: true,
      maxContext: 16384,
      concurrency: 4,
    },
  ],
  pools: [
    {
      id: 'pool',
      name: 'Workers',
      members: [{ instanceId: 'lan', workerLimit: 2 }],
    },
  ],
  usage: {},
}
it('admits ready assignments and queues compatible busy ones without weakening requirements', () => {
  expect(roleReadiness(assignment, '', catalog).status).toBe('ready')
  expect(
    roleReadiness(assignment, '', { ...catalog, usage: { lan: 2 } })
  ).toMatchObject({ status: 'busy', canStart: true })
  expect(
    roleReadiness({ ...assignment, minimumContext: 32768 }, '', catalog)
  ).toMatchObject({ status: 'incompatible', canStart: false })
  expect(
    roleReadiness(assignment, '', {
      ...catalog,
      instances: [{ ...catalog.instances[0], vision: false }],
    }).canStart
  ).toBe(false)
})
it('separates offline from unknown and honors limits in overlapping pools', () => {
  expect(
    roleReadiness(assignment, '', { ...catalog, instances: [] }).status
  ).toBe('offline')
  expect(
    roleReadiness(assignment, '', {
      ...catalog,
      instances: [{ ...catalog.instances[0], maxContext: 0 }],
    }).status
  ).toBe('unknown')
  expect(
    roleReadiness(assignment, '', {
      ...catalog,
      usage: { lan: 1 },
      pools: [
        ...catalog.pools,
        {
          id: 'other',
          name: 'Other',
          members: [{ instanceId: 'lan', workerLimit: 1 }],
        },
      ],
    }).status
  ).toBe('busy')
})

it('resolves exact legacy aliases and fleet preference while retaining full unassigned pool visibility', () => {
  const shared = {
    ...catalog,
    aliases: { 'saved-local': 'lan' },
    fleetTargets: ['lan'],
    fleet: { connected: true },
    availablePoolIds: [],
  }
  expect(shared.pools[0].id).toBe('pool')
  expect(roleReadiness(assignment, '', shared)).toMatchObject({
    canStart: false,
    message: expect.stringContaining('not assigned'),
  })
  expect(
    roleReadiness(
      { ...assignment, target: { kind: 'instance', id: 'saved-local' } },
      '',
      shared
    ).canStart
  ).toBe(true)
  expect(
    roleReadiness({ ...assignment, target: { kind: 'fleet' } }, '', shared)
      .canStart
  ).toBe(true)
  expect(
    roleReadiness({ ...assignment, target: { kind: 'fleet' } }, '', {
      ...shared,
      fleet: { connected: false },
    }).canStart
  ).toBe(false)
})
