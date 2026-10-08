import { useEffect } from 'react'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { createFileRoute } from '@tanstack/react-router'

// The persistent terminal is owned by the root layout so its parser, cursor,
// alternate screen, and scrollback survive navigation. This route is only the
// URL/visibility boundary.
export const Route = createFileRoute('/code')({
  validateSearch: (search: Record<string, unknown>): { session?: string } => ({
    session: typeof search.session === 'string' ? search.session : undefined,
  }),
  component: CodeRoute,

})

function CodeRoute() {
  const { session } = Route.useSearch()
  useEffect(() => {
    if (session) useCodeTerminalStore.getState().setSelectedThreadId(session)
  }, [session])
  return null
}
