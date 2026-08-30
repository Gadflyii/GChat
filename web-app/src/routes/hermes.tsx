import { createFileRoute } from '@tanstack/react-router'

// The persistent terminal is owned by the root layout so Hermes sessions and
// screen state survive navigation. This route is the URL/visibility boundary.
export const Route = createFileRoute('/hermes')({
  component: () => null,
})
