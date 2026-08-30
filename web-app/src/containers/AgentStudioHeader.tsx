import type { ReactNode } from 'react'
import {
  IconBolt,
  IconFileText,
  IconHistory,
  IconTemplate,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import HeaderPage from '@/containers/HeaderPage'

export type AgentStudioSection =
  | 'definitions'
  | 'templates'
  | 'skills'
  | 'runs'

type AgentStudioHeaderProps = {
  active: AgentStudioSection
  actions?: ReactNode
  onSelect: (section: AgentStudioSection) => void
}

const sections = [
  { id: 'definitions', label: 'Agents & flows', icon: IconBolt },
  { id: 'templates', label: 'Templates', icon: IconTemplate },
  { id: 'skills', label: 'Skills', icon: IconFileText },
  { id: 'runs', label: 'Runs', icon: IconHistory },
] as const

export function AgentStudioHeader({
  active,
  actions,
  onSelect,
}: AgentStudioHeaderProps) {
  return (
    <HeaderPage>
      <div className="flex w-full items-center justify-between gap-3">
        <div>
          <div className="font-studio text-base font-semibold">
            Agent Studio
          </div>
          <div className="text-xs text-muted-foreground">
            Build agents, evaluative loops, coordinated teams, workflows, and
            reusable skills.
          </div>
        </div>
        <div className="flex items-center gap-3">
          {actions && <div className="flex items-center gap-2">{actions}</div>}
          <nav
            aria-label="Agent Studio sections"
            className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1"
          >
            {sections.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={active === id ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onSelect(id)}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            ))}
          </nav>
        </div>
      </div>
    </HeaderPage>
  )
}
