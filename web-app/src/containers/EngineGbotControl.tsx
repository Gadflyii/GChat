import { Button } from '@/components/ui/button'
import { confirmAction } from '@/lib/confirm'
import type { EngineSnapshot } from '@/services/engines'

const controlStatusLabels = {
  not_requested: 'No access requested',
  pending: 'Waiting for your permission',
  approved: 'Access allowed',
  revoked: 'Access removed',
}

export function EngineGbotControl({
  clients = [],
  disabled,
  change,
}: {
  clients?: EngineSnapshot['clients']
  disabled: boolean
  change: (clientId: string, action: 'approve' | 'revoke') => Promise<boolean>
}) {
  const devices = clients.filter(
    (client) =>
      !client.local &&
      client.gbot_control?.status !== 'not_requested' &&
      client.gbot_control
  )
  if (!devices.length) return null
  return (
    <details className="space-y-3 rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">Access to bots and desktops</summary>
      <p className="text-sm text-muted-foreground">
        Give each paired computer permission separately. This lets it control
        this computer's bots, accounts and desktops. Connecting to use models
        does not give this access.
      </p>
      {devices.map((client) => (
        <div
          key={client.client_id}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-sm">
            {client.name} · {controlStatusLabels[client.gbot_control!.status]}
          </span>
          {client.gbot_control!.status === 'pending' && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={async () => {
                if (
                  await confirmAction({
                    title: 'Allow access to bots and desktops?',
                    message: `Allow ${client.name} to control this computer's bots, accounts and desktops?`,
                    confirmLabel: 'Allow access',
                  })
                )
                  void change(client.client_id, 'approve')
              }}
            >
              Allow access for {client.name}
            </Button>
          )}
          {client.gbot_control!.status === 'approved' && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={async () => {
                if (
                  await confirmAction({
                    title: 'Remove access to bots and desktops?',
                    message: `Remove ${client.name}'s access to this computer's bots, accounts and desktops? Its open desktop views will close. Running bot tasks continue.`,
                    confirmLabel: 'Remove access',
                    destructive: true,
                  })
                )
                  void change(client.client_id, 'revoke')
              }}
            >
              Remove access for {client.name}
            </Button>
          )}
        </div>
      ))}
    </details>
  )
}
