import GbotAvatar from '@/components/GbotAvatar'
import {
  avatarStatus,
  botAvatarState,
  useGbotCompanion,
} from '@/stores/gbot-companion-store'

export default function GbotAvatars() {
  const state = useGbotCompanion()
  const bots = state.snapshot.workspaces
  return (
    <div className="space-y-1 border-b px-2 pb-3 pt-3" aria-label="Your bots">
      {bots.length ? (
        bots.map((bot) => {
          const animation = botAvatarState(state, bot.id)
          return (
            <button
              key={bot.id}
              type="button"
              aria-label={`Open ${bot.name} · ${avatarStatus[animation]}`}
              aria-controls="gbot-companion"
              aria-expanded={
                state.mode !== 'hidden' && state.selected === bot.id
              }
              data-gbot-avatar={bot.id}
              onClick={() => state.open(bot.id)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sidebar-foreground/10 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <GbotAvatar state={animation} size={36} decorative />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {bot.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {avatarStatus[animation]}
                </span>
              </span>
            </button>
          )
        })
      ) : (
        <button
          type="button"
          aria-label="Open Gbot companion"
          aria-controls="gbot-companion"
          aria-expanded={state.mode !== 'hidden'}
          onClick={() => state.open()}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-sidebar-foreground/10"
        >
          <GbotAvatar state="sleeping" size={36} decorative />
          <span>Your bot</span>
        </button>
      )}
    </div>
  )
}
