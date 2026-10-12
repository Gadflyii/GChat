import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { gbot, type KvmSetupRecord, type SetupIssue } from '@/services/gbot'

type Preflight = {
  ready: boolean
  issues: SetupIssue[]
  cpus: number
  memory_mib: number
  disk_gib: number
}
const stages: Record<string, string> = {
  checking_pc: 'Checking this PC',
  preparing_computer: 'Preparing the guest disk and secure connection',
  starting_computer: 'Starting the separate computer',
  connecting: 'Waiting for guest setup and verifying SSH',
  testing_desktop: 'Checking guest files, desktop input and media connection',
  ready: 'Computer ready',
  removing: 'Removing this setup’s owned computer',
  removed: 'Computer removed',
}
export default function KvmSetup({
  name,
  connected,
  initialId,
}: {
  name: string
  initialId?: string
  connected: (id: string) => Promise<void>
}) {
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [records, setRecords] = useState<KvmSetupRecord[]>([])
  const [current, setCurrent] = useState<string | null>(initialId ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const newId = useRef(crypto.randomUUID())
  const refresh = useCallback(async () => {
    const saved = await gbot<KvmSetupRecord[]>('setup/kvm/status', {})
    setRecords(saved.filter((record) => record.stage !== 'removed'))
  }, [])
  const check = useCallback(async () => {
    setError('')
    try {
      setPreflight(await gbot<Preflight>('setup/kvm/preflight', {}))
      await refresh()
    } catch (cause) {
      setError(String(cause))
    }
  }, [refresh])
  useEffect(() => {
    void check()
    const subscription = listen('gbot-setup-update', () => {
      void refresh().catch((cause) => setError(String(cause)))
    })
    return () => {
      void subscription.then((unlisten) => unlisten())
    }
  }, [check, refresh])
  const visibleRecords = initialId
    ? records.filter((saved) => saved.id === initialId)
    : records
  const record = records.find((saved) => saved.id === current)
  const act = async (path: 'start' | 'remove', saved?: KvmSetupRecord) => {
    setBusy(true)
    setError('')
    try {
      const id = saved?.id ?? newId.current
      setCurrent(id)
      const result = await gbot<KvmSetupRecord>(
        `setup/kvm/${path}`,
        path === 'start' ? { id, name: saved?.name ?? name.trim() } : { id }
      )
      setRecords((previous) => [
        ...previous.filter((item) => item.id !== id),
        ...(result.stage === 'removed' ? [] : [result]),
      ])
      if (result.stage === 'removed') {
        setCurrent(null)
        newId.current = crypto.randomUUID()
      }
      await refresh()
    } catch (cause) {
      setError(String(cause))
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3" aria-label="Local VM setup">
      <p className="text-sm">
        {initialId
          ? 'Resume the saved separate Linux computer: '
          : 'Review the separate Linux computer before creating it: '}
        2 CPU threads, 4
        GiB memory and a 40 GiB guest disk. GChat keeps its generated connection
        key in the secure vault.
      </p>
      <p className="text-sm text-muted-foreground">
        The approved Debian image, Cua Driver and media bundle must already be
        staged in the GChat data folder. Setup checks their accepted digests and
        does not install host packages or download guest assets. Hyper-V remains
        unfinished.
      </p>
      {!preflight && !error && (
        <p role="status">Checking local VM prerequisites…</p>
      )}
      {preflight?.issues.map((issue, index) => (
        <div
          key={`${issue.code}-${index}`}
          className="rounded-md border p-3 text-sm"
        >
          <p className="font-medium">{issue.message}</p>
          <p>{issue.next_action}</p>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void check()}
      >
        Check prerequisites again
      </Button>
      {!initialId && !current && (
        <Button
          type="button"
          disabled={busy || !preflight?.ready}
          onClick={() => void act('start')}
        >
          {busy ? 'Starting setup…' : `Create ${name.trim()}’s computer`}
        </Button>
      )}
      {visibleRecords.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Saved local computer setups</p>
          {visibleRecords.map((saved) => (
            <div
              key={saved.id}
              className="space-y-2 rounded-md border p-3 text-sm"
            >
              <p className="font-medium">
                {saved.name} · {stages[saved.stage] ?? saved.stage}
              </p>
              {saved.issue && (
                <div role="alert">
                  <p>{saved.issue.message}</p>
                  <p>{saved.issue.next_action}</p>
                </div>
              )}
              <div className="flex gap-2">
                {saved.stage === 'ready' ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void connected(saved.id).catch((cause) =>
                        setError(String(cause))
                      )
                    }
                  >
                    Use this computer
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={
                      busy || !preflight?.ready || saved.stage === 'removing'
                    }
                    onClick={() => void act('start', saved)}
                  >
                    Resume setup
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act('remove', saved)}
                >
                  Remove owned computer
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {record && record.stage !== 'ready' && (
        <p role="status" className="text-sm">
          {stages[record.stage] ?? record.stage}. Progress is saved by the
          service; closing this wizard preserves the setup.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
