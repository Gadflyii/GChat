import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { ModelManagement } from '@/containers/ModelManagement'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.hub.index as any)({
  component: ModelsRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    model: typeof search.model === 'string' ? search.model : undefined,
    repo: typeof search.repo === 'string' ? search.repo : undefined,
  }),
})

function ModelsRoute() {
  const search = Route.useSearch()
  return <ModelManagement initialQuery={search.q ?? search.model ?? search.repo ?? ''} />
}
