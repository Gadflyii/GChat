import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { route } from '@/constants/routes'
import { useOnboardingModelReminder } from '@/hooks/useOnboardingModelReminder'

export function PromptOnboardingModel() {
  const { setPending } = useOnboardingModelReminder()
  const navigate = useNavigate()
  return <aside className="fixed bottom-5 right-5 z-40 max-w-sm space-y-3 rounded-xl border bg-background p-5 shadow-lg">
    <h2 className="font-medium">Ready to add a model?</h2>
    <p className="text-sm text-muted-foreground">Choose a local or LAN host in Models to see compatible published packages.</p>
    <div className="flex gap-2">
      <Button onClick={() => { setPending(false); void navigate({ to: route.hub.index }) }}>Open Models</Button>
      <Button variant="ghost" onClick={() => setPending(false)}>Dismiss</Button>
    </div>
  </aside>
}
