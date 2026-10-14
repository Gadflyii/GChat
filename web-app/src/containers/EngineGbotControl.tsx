import { Button } from '@/components/ui/button'
import type { EngineSnapshot } from '@/services/engines'

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
      <summary className="cursor-pointer font-medium">Gbot control</summary>
      <p className="text-sm text-muted-foreground">
        Approve each paired device separately. Access controls this computer's
        bots, accounts and desktops. Inference pairing alone does not grant it.
      </p>
      {devices.map((client) => (
        <div
          key={client.client_id}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-sm">
            {client.name} · {client.gbot_control!.status}
          </span>
          {client.gbot_control!.status === 'pending' && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                if (
                  window.confirm(
                    `Allow ${client.name} to control this computer's Gbot service, bots, accounts and desktops?`
                  )
                )
                  void change(client.client_id, 'approve')
              }}
            >
              Approve Gbot control for {client.name}
            </Button>
          )}
          {client.gbot_control!.status === 'approved' && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                if (
                  window.confirm(
                    `Revoke ${client.name}'s Gbot control? Its connected desktop views will close. Running bot tasks continue.`
                  )
                )
                  void change(client.client_id, 'revoke')
              }}
            >
              Revoke Gbot control for {client.name}
            </Button>
          )}
        </div>
      ))}
    </details>
  )
}
