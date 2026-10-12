# Gbot seed archive sources

The physical KVM onboarding gate found that a validated archive asset may be a host symlink. genisoimage preserves that symlink under Rock Ridge, leaving a guest-visible link to a host-only path and preventing first boot readiness.

Resolve each seed archive source to its canonical regular file before constructing its graft argument. The seed then embeds the same bytes consumed by asset validation and digest checks. Asset ownership, pins, and guest verification remain unchanged. The focused regression exercises prepare with symlink assets and checks both graft arguments resolve to regular files containing the accepted bytes.
