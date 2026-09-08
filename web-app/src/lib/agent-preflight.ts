import type {
  AgentModelInstance,
  AgentRoleAssignment,
  AgentWorkerPool,
} from '@/types/agent'

export type RoleReadiness = {
  status: 'ready' | 'busy' | 'offline' | 'incompatible' | 'unknown'
  message: string
  canStart: boolean
}

export function roleReadiness(
  assignment: AgentRoleAssignment,
  current: string,
  catalog: {
    instances: AgentModelInstance[]
    pools: AgentWorkerPool[]
    usage: Record<string, number>
  }
): RoleReadiness {
  if (
    !Number.isSafeInteger(assignment.minimumContext) ||
    assignment.minimumContext < 0 ||
    assignment.minimumContext > 16777216
  )
    return {
      status: 'incompatible',
      message: 'Enter a valid minimum context size.',
      canStart: false,
    }
  const target = assignment.target
  const pool =
    target.kind === 'pool'
      ? catalog.pools.find((p) => p.id === target.id)
      : undefined
  if (target.kind === 'pool' && !pool)
    return {
      status: 'offline',
      message: 'Select an existing worker pool.',
      canStart: false,
    }
  const members = pool?.members ?? [
    {
      instanceId: target.kind === 'instance' ? target.id : current,
      workerLimit: 8,
    },
  ]
  const available = members.flatMap((m) => {
    const instance = catalog.instances.find((i) => i.id === m.instanceId)
    return instance ? [{ instance, limit: m.workerLimit }] : []
  })
  if (!available.length)
    return {
      status: 'offline',
      message:
        'No assigned instance is ready. Start a model in Engines or choose another assignment.',
      canStart: false,
    }
  const capable = available.filter(
    ({ instance: i }) =>
      (!assignment.vision || i.vision === true) &&
      (!assignment.minimumContext ||
        (i.maxContext ?? 0) >= assignment.minimumContext)
  )
  if (!capable.length) {
    const unknown = available.some(
      ({ instance: i }) =>
        (!assignment.vision || i.vision !== false) &&
        (!assignment.minimumContext ||
          !i.maxContext ||
          i.maxContext >= assignment.minimumContext)
    )
    return {
      status: unknown ? 'unknown' : 'incompatible',
      message: unknown
        ? 'Required capabilities are not reported. Refresh or choose an instance with known Vision/context support.'
        : 'No ready member meets the Vision/context requirements. Adjust the requirements or assignment.',
      canStart: false,
    }
  }
  const free = capable.some(({ instance, limit }) => {
    const sharedLimits = catalog.pools.flatMap((p) =>
      p.members
        .filter((m) => m.instanceId === instance.id)
        .map((m) => m.workerLimit)
    )
    const capacity = Math.min(instance.concurrency ?? 1, limit, ...sharedLimits)
    return (catalog.usage[instance.id] ?? 0) < capacity
  })
  return free
    ? {
        status: 'ready',
        message: 'Ready. Capacity is checked again at dispatch.',
        canStart: true,
      }
    : {
        status: 'busy',
        message:
          'Compatible, but busy. This role will queue until a slot is free.',
        canStart: true,
      }
}
