import { createFileRoute } from '@tanstack/react-router'

// The persistent terminal is owned by the root layout so its parser, cursor,
// alternate screen, and scrollback survive navigation. This route is only the
// URL/visibility boundary.
export const Route = createFileRoute('/code')({
  component: () => null,
})
