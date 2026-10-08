import { describe, expect, it } from 'vitest'
import { filterSidebarHistoryThreads, filterDeletableSidebarHistoryThreads } from './sidebar-history'

describe('shared sidebar history', () => {
  const threads = [{ id: 'chat' }, { id: 'agent' }, { id: 'favorite', isFavorite: true }, { id: 'project', metadata: { project: 'p1' } }]
  it('includes conversations created by Chat and Agent and keeps project conversations in their project', () => {
    expect(filterSidebarHistoryThreads(threads)).toEqual(threads.slice(0, 3))
  })
  it('keeps favorite and project conversations out of bulk deletion', () => {
    expect(filterDeletableSidebarHistoryThreads(threads)).toEqual(threads.slice(0, 2))
  })
})
