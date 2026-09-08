import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { studioCommand, type StudioCatalog } from '@/services/agent/studio'
import type { AgentWorkerPool } from '@/types/agent'

export function AgentWorkerPools() {
  const [catalog, setCatalog] = useState<StudioCatalog>({
    pools: [],
    instances: [],
    usage: {},
  })
  const [draft, setDraft] = useState<AgentWorkerPool | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () =>
    studioCommand<StudioCatalog>('capacity')
      .then(setCatalog)
      .catch((e) => toast.error(String(e)))
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [])
  const save = async () => {
    if (!draft) return
    setBusy(true)
    try {
      setDraft(await studioCommand<AgentWorkerPool>('save_pool', draft))
      await refresh()
      toast.success('Worker pool saved')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }
  const ids = [
    ...new Set([
      ...catalog.instances.map((i) => i.id),
      ...(draft?.members.map((m) => m.instanceId) ?? []),
    ]),
  ]
  return (
    <div className="overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-studio text-lg font-semibold">Worker Pools</h2>
          <p className="text-sm text-muted-foreground">
            Group inference capacity. Your tools and files stay on this
            computer.
          </p>
        </div>
        <Button onClick={() => setDraft({ id: '', name: '', members: [] })}>
          Create pool
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(200px,1fr)_2fr]">
        <div className="space-y-2">
          {!catalog.pools.length && (
            <p className="rounded-lg border p-6 text-muted-foreground">
              Create a pool to distribute independent workers across your paired
              hosts.
            </p>
          )}
          {catalog.pools.map((pool) => (
            <Button
              key={pool.id}
              variant={draft?.id === pool.id ? 'secondary' : 'outline'}
              className="w-full justify-between"
              onClick={() => setDraft(structuredClone(pool))}
            >
              <span>{pool.name}</span>
              <span>{pool.members.length} instances</span>
            </Button>
          ))}
        </div>
        {draft && (
          <section className="rounded-lg border bg-card p-5 space-y-4">
            <label className="block text-sm">
              Pool name
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Coding workers"
              />
            </label>
            <p className="text-sm text-muted-foreground">
              Choose members explicitly. Limits never exceed engine concurrency.
              If an instance is in several pools, its lowest configured limit
              applies to this GChat’s workers. Other clients and interactive
              requests may still use the engine.
            </p>
            {!ids.length && (
              <p>
                No ready instances yet. Pair a host and load a model in Engines
                first.
              </p>
            )}
            {ids.map((id) => {
              const instance = catalog.instances.find((i) => i.id === id)
              const member = draft.members.find((m) => m.instanceId === id)
              return (
                <div
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!member}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          members: e.target.checked
                            ? [
                                ...draft.members,
                                { instanceId: id, workerLimit: 1 },
                              ]
                            : draft.members.filter((m) => m.instanceId !== id),
                        })
                      }
                    />
                    <span>
                      {instance
                        ? `${instance.hostName ?? 'Host'} / ${instance.modelId}`
                        : id}
                      <small className="block text-muted-foreground">
                        {instance
                          ? `Ready · ${instance.vision ? 'Vision + text' : 'Text'} · C${instance.concurrency ?? '?'} · ${catalog.usage[id] ?? 0} workers active`
                          : 'Offline · retained member'}
                      </small>
                    </span>
                  </label>
                  {member && (
                    <label className="text-xs">
                      Worker limit
                      <Input
                        className="w-20"
                        type="number"
                        min={1}
                        max={instance?.concurrency || 8}
                        value={member.workerLimit}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            members: draft.members.map((m) =>
                              m.instanceId === id
                                ? { ...m, workerLimit: Number(e.target.value) }
                                : m
                            ),
                          })
                        }
                      />
                    </label>
                  )}
                </div>
              )
            })}
            <p className="text-sm text-muted-foreground">
              When full: queue. Running workers stay on their assigned instance.
              Models are never loaded or replaced automatically.
            </p>
            <div className="flex gap-2">
              <Button
                disabled={
                  busy ||
                  !draft.name.trim() ||
                  !draft.members.length ||
                  draft.members.some(
                    (m) =>
                      !Number.isInteger(m.workerLimit) ||
                      m.workerLimit < 1 ||
                      m.workerLimit > 8
                  )
                }
                onClick={() => void save()}
              >
                Save pool
              </Button>
              {draft.id && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        'Delete this pool? Existing runs keep their assignment snapshot; new runs must choose another pool.'
                      )
                    )
                      return
                    try {
                      await studioCommand('delete_pool', { id: draft.id })
                      setDraft(null)
                      await refresh()
                    } catch (e) {
                      toast.error(String(e))
                    }
                  }}
                >
                  Delete pool
                </Button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
