import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { gbot, type Approval, type Task } from '@/services/gbot'
import { notifyThreadCompleted } from '@/lib/notifications'
import { gbotAlerts, snapshotOf, type GbotSnapshot } from '@/lib/gbot-alerts'
import { useThreadNotifications } from '@/hooks/useThreadNotifications'

function lookingAtGbot(): boolean {
  if (typeof document === 'undefined') return false
  const focused =
    document.visibilityState === 'visible' &&
    (typeof document.hasFocus !== 'function' || document.hasFocus())
  const place = `${window.location.pathname}${window.location.hash}`
  return focused && place.includes('/gbot')
}

/**
 * Desktop notification when a Gbot task finishes, needs review or an answer, or has a
 * new approval waiting, even while another page is open. It only reads what the
 * connected service already reports; when the service is not connected the fetch fails
 * and nothing happens, so it never starts the service or touches secure storage.
 * Uses the same master switch as reply notifications.
 */
export function useGbotNotifications(): void {
  useEffect(() => {
    if (!IS_TAURI) return
    let disposed = false
    let snapshot: GbotSnapshot | null = null
    let running = false
    let again = false
    const check = async () => {
      if (running) {
        again = true
        return
      }
      running = true
      try {
        do {
          again = false
          let tasks: Task[]
          let approvals: Approval[]
          try {
            const [history, pending] = await Promise.all([
              gbot<Task[]>('tasks'),
              gbot<Approval[]>('tasks/approvals'),
            ])
            tasks = history
            approvals = pending
          } catch {
            snapshot = null
            return
          }
          if (disposed) return
          const alerts = gbotAlerts(snapshot, tasks, approvals)
          snapshot = snapshotOf(tasks, approvals)
          if (
            alerts.length > 0 &&
            useThreadNotifications.getState().globallyEnabled !== false &&
            !lookingAtGbot()
          )
            for (const alert of alerts)
              void notifyThreadCompleted(alert.title, alert.body)
        } while (again)
      } finally {
        running = false
      }
    }
    const subscription = listen('gbot-task-update', () => void check())
    return () => {
      disposed = true
      void subscription.then((stop) => stop())
    }
  }, [])
}
