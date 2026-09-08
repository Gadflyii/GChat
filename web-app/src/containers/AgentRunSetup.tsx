import { useState } from 'react'
import { useStudioCatalog } from '@/hooks/useStudioCatalog'
import { roleReadiness } from '@/lib/agent-preflight'
import { StatusLabel } from './StatusLabel'
import { AgentWorkerPools } from '@/containers/AgentWorkerPools'
import { WorkspacePicker } from '@/containers/WorkspacePicker'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useStudioRuns } from '@/stores/studio-run-store'
import { defaultAssignments, placementRoles } from '@/services/agent/studio'
import { saveAgentDefinition } from '@/services/agent/definitions'
import type { AgentDefinition, AgentRoleAssignment } from '@/types/agent'

const selectClass =
  'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground'
export function AgentRunSetup({
  definition,
  onClose,
  onRun,
  initialTask = '',
  initialWorkspace = '',
}: {
  definition: AgentDefinition
  onClose: () => void
  onRun: () => void
  initialTask?: string
  initialWorkspace?: string
}) {
  const [showPools, setShowPools] = useState(false)
  const { catalog, error: catalogError, refresh } = useStudioCatalog()
  const [task, setTask] = useState(initialTask)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [workspaceValid, setWorkspaceValid] = useState(false)
  const [assignments, setAssignments] = useState(defaultAssignments(definition))
  const [saveDefaults, setSaveDefaults] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = useModelProvider((s) => s.selectedModel?.id ?? '')
  const roles = placementRoles(definition)
  const change = (id: string, patch: Partial<AgentRoleAssignment>) =>
    setAssignments((s) => ({ ...s, [id]: { ...s[id], ...patch } }))
  const readiness = Object.fromEntries(
    roles.map(({ id }) => [
      id,
      roleReadiness(assignments[id], current, catalog),
    ])
  )
  const missing =
    !workspaceValid ||
    !!catalogError ||
    roles.some(({ id }) => !readiness[id].canStart)
  const start = async () => {
    if (missing || !task.trim()) return
    setBusy(true)
    try {
      if (saveDefaults)
        await saveAgentDefinition({
          ...definition,
          roleAssignments: assignments,
        })
      const id = crypto.randomUUID()
      useStudioRuns.getState().start(definition.name, {
        run_id: id,
        session_id: id,
        model_id: current || 'explicit-role-assignment',
        user_message: task,
        definition_id: definition.id,
        role_assignments: assignments,
        working_dir: workspace.trim() || undefined,
        auto_approve: false,
      })
      onRun()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Run {definition.name}</DialogTitle>
          <DialogDescription>
            Assign each role, review the task, then start. Tools and workspace
            operations run on this GChat computer.
          </DialogDescription>
        </DialogHeader>
        {catalogError && (
          <p role="alert" className="text-sm text-destructive">
            Cannot refresh engine capacity. Last-known data is shown.{' '}
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </p>
        )}
        <label className="space-y-1 text-sm">
          Task or goal
          <textarea
            className={`${selectClass} min-h-24`}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What should this run accomplish? Include what a complete result should contain."
          />
        </label>
        <WorkspacePicker
          value={workspace}
          onChange={setWorkspace}
          onValidity={setWorkspaceValid}
        />
        <div className="space-y-3">
          {roles.map((role) => {
            const assignment = assignments[role.id]
            const targetValue =
              assignment.target.kind === 'current'
                ? 'current'
                : `${assignment.target.kind}:${assignment.target.id}`
            return (
              <section
                key={role.id}
                className="rounded-lg border p-3 space-y-2"
              >
                <label className="text-sm font-medium">
                  {role.name}
                  <select
                    aria-label={`${role.name} assignment`}
                    className={selectClass}
                    value={targetValue}
                    onChange={(e) => {
                      const [kind, ...rest] = e.target.value.split(':')
                      change(role.id, {
                        target:
                          kind === 'current'
                            ? { kind }
                            : {
                                kind: kind as 'pool' | 'instance',
                                id: rest.join(':'),
                              },
                      })
                    }}
                  >
                    <option value="current">
                      Current model
                      {current ? ` · ${current}` : ' · none selected'}
                    </option>
                    <optgroup label="Worker pools">
                      {catalog.pools.map((pool) => (
                        <option key={pool.id} value={`pool:${pool.id}`}>
                          {pool.name} · {pool.members.length} members
                        </option>
                      ))}
                    </optgroup>
                    {[
                      ...new Set(
                        catalog.instances.map((i) => i.hostName ?? 'Host')
                      ),
                    ].map((host) => (
                      <optgroup label={host} key={host}>
                        {catalog.instances
                          .filter((i) => (i.hostName ?? 'Host') === host)
                          .map((i) => (
                            <option key={i.id} value={`instance:${i.id}`}>
                              {i.modelId} · C{i.concurrency ?? '?'}
                              {i.vision ? ' · Vision' : ''}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                    {targetValue !== 'current' &&
                      !(assignment.target.kind === 'pool'
                        ? catalog.pools.some(
                            (p) => `pool:${p.id}` === targetValue
                          )
                        : catalog.instances.some(
                            (i) => `instance:${i.id}` === targetValue
                          )) && (
                        <option value={targetValue}>
                          Unavailable · {targetValue}
                        </option>
                      )}
                  </select>
                </label>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label>
                    <input
                      type="checkbox"
                      checked={assignment.vision}
                      onChange={(e) =>
                        change(role.id, { vision: e.target.checked })
                      }
                    />{' '}
                    Requires Vision
                  </label>
                  <label className="flex items-center gap-2">
                    Minimum context
                    <Input
                      className="w-28"
                      type="number"
                      min={0}
                      value={assignment.minimumContext}
                      onChange={(e) =>
                        change(role.id, {
                          minimumContext: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <p className="text-sm text-muted-foreground" role="status">
                  <StatusLabel status={readiness[role.id].status} /> ·{' '}
                  {readiness[role.id].message}
                </p>
              </section>
            )
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          Compatible busy assignments queue until capacity is available.
          Assignments stay pinned once work begins. {definition.maxSteps} tool
          steps per main stage
          {definition.kind === 'goal_loop'
            ? `; up to ${definition.maxCycles} cycles`
            : definition.kind === 'coordinator'
              ? `; up to ${definition.maxParallel} parallel workers`
              : ''}
          . Tool approvals remain enabled.
        </p>
        {missing && (
          <p role="alert" className="text-sm text-destructive">
            Select available targets for every role and use valid context
            limits.
          </p>
        )}
        <label className="text-sm">
          <input
            type="checkbox"
            checked={saveDefaults}
            onChange={(e) => setSaveDefaults(e.target.checked)}
          />{' '}
          Save these role assignments as defaults
        </label>
        {showPools && <AgentWorkerPools />}
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => setShowPools(!showPools)}>
            {showPools ? 'Hide pool editor' : 'Create or edit pools'}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || missing || !task.trim()}
              onClick={() => void start()}
            >
              Run
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
