import { createFileRoute } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'
import { MemoryLibrary } from '@/containers/MemoryLibrary'

export const Route = createFileRoute('/memory/')({ component: MemoryPage })
function MemoryPage() {
  return (
    <>
      <HeaderPage>
        <span>Memory</span>
      </HeaderPage>
      <div className="min-h-0 flex-1 overflow-auto">
        <MemoryLibrary />
      </div>
    </>
  )
}
