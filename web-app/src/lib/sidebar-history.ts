export function filterSidebarHistoryThreads<
  T extends {
    id: string
    isFavorite?: boolean
    metadata?: { project?: unknown }
  },
>(
  threads: readonly T[],
): T[] {
  return threads.filter(
    (thread) => !thread.metadata?.project
  )
}

export function filterDeletableSidebarHistoryThreads<
  T extends {
    id: string
    isFavorite?: boolean
    metadata?: { project?: unknown }
  },
>(
  threads: readonly T[],
): T[] {
  return filterSidebarHistoryThreads(threads).filter(
    (thread) => !thread.isFavorite
  )
}
