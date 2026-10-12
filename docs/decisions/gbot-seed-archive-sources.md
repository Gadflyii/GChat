# Gbot seed archive sources

The physical KVM onboarding gate found that a validated archive asset may be a host symlink. genisoimage preserves that symlink under Rock Ridge, leaving a guest-visible link to a host-only path and preventing first boot readiness.

Resolve each seed archive source to its canonical regular file before constructing its graft argument. The seed then embeds the same bytes consumed by asset validation and digest checks. Asset ownership, pins, and guest verification remain unchanged. The focused regression exercises prepare with symlink assets and checks both graft arguments resolve to regular files containing the accepted bytes.

The bounded physical retry at 2026-10-12 20:44Z used the current authenticated native API (`preflight`, `start`, setup watch). Both ISO archive entries were regular files and their extracted SHA256 values matched the accepted pins. First boot completed, then the owner reported `testing_desktop` with `guest_not_ready`; Ready was not achieved and no browser form success is claimed.

Diagnostic collection was interrupted by the opt-in example's fatal rejection of an evidence tag containing an underscore. Its disposable DBus/keyring session ended, leaving the existing credential unavailable. No replacement key or further guest was created. Both owned guests, disk/data, and disposable vault/controller paths were retired, and CPU resources released. The failed tool detail remains unresolved: `KvmSetup::guest` currently reduces failed or refused replies, including desktop `isError`, to a generic issue without retaining the tool name/result. Future physical acceptance must retain that result and use a recoverable diagnostic session. Installed wizard presentation, product Ready, and same-guest browser form plus independent SSH readback remain owed.

Durable gate evidence and inventory: `/ai/gchat/out/gchat-open-items-20261012/wizard-physical/wizard-physical-note.md`. No broad suite, model, GPU, release, or host dependency installation was performed.
