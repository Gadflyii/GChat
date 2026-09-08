import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'
import { EngineIntake } from '@/containers/EngineIntake'
import { Button } from '@/components/ui/button'
import { localStorageKey } from '@/constants/localStorage'
import { route } from '@/constants/routes'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useOnboardingModelReminderStore } from '@/hooks/useOnboardingModelReminder'

export default function SetupScreen({ onSkipped }: { onSkipped?: () => void }) {
  const navigate = useNavigate()
  useEffect(() => { useLeftPanel.getState().setLeftPanel(true) }, [])
  const finish = (destination?: string) => {
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    useOnboardingModelReminderStore.getState().setPending(false)
    window.dispatchEvent(new Event('app:setup-completed'))
    if (destination) void navigate({ to: destination, replace: true })
    else onSkipped?.()
  }
  return <div className="flex h-full flex-col overflow-hidden">
    <HeaderPage />
    <main className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-xl space-y-6 py-8">
        <div className="text-center">
          <img src="/images/gchat-lockup.png" alt="GChat by Sectile Research Laboratories" className="mx-auto h-24 max-w-full object-contain dark:hidden" />
          <img src="/images/gchat-lockup-reversed.png" alt="GChat by Sectile Research Laboratories" className="mx-auto hidden h-24 max-w-full object-contain dark:block" />
          <h1 className="mt-5 text-xl font-medium">Welcome to GChat</h1>
          <p className="mt-2 text-sm text-muted-foreground">Run a model here, or use a GInfer host on your network.</p>
        </div>
        <section className="space-y-3 rounded-xl border p-5">
          <h2 className="font-medium">Find a model for this computer</h2>
          <p className="text-sm text-muted-foreground">We match published GInfer packages to your detected GPU and memory. Installed models remain available; downloads are optional.</p>
          <Button onClick={() => finish(route.hub.index)}>Choose a model</Button>
        </section>
        <EngineIntake onConnect={() => finish(route.engines.index)} />
        <p className="text-sm text-muted-foreground">Other configured providers remain available in Settings. You can return to Models or Engines at any time.</p>
        <Button variant="ghost" onClick={() => finish()}>Continue without loading a model</Button>
      </div>
    </main>
  </div>
}
