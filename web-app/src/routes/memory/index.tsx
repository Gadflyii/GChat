import { createFileRoute } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'
import { MemoryLibrary } from '@/containers/MemoryLibrary'

export const Route = createFileRoute('/memory/')({ component: MemoryPage })
function MemoryPage() {
  return (
    <>
      <HeaderPage>
        <div className="flex w-full items-center justify-between pr-4">
          <h1>Memory</h1>
          <div id="page-header-actions" />
        </div>
      </HeaderPage>
      <div className="min-h-0 flex-1 overflow-auto">
        <MemoryLibrary />
      </div>
    </>
  )
}
