export function profileEvidenceLabel(tier) {
  return tier === 'full-context-tested' ? 'Tested'
    : tier === 'screened-startup' ? 'Screened, not full-context qualified'
    : tier === 'calculated-startup-smoke' ? 'Estimated' : 'Untested'
}

export function profileOptionLabel(profile, recommended) {
  const context = profile.max_context % 1024 === 0
    ? `${profile.max_context / 1024}K` : profile.max_context.toLocaleString()
  return `${recommended ? 'Recommended · ' : ''}${profileEvidenceLabel(profile.qualification.tier)} · C${profile.concurrency} · ${context} context · ${profile.options.vision ? 'Vision + text' : 'Text only'}`
}

export function profilePresentation(profiles, selectedIndex, showAll) {
  let recommendedIndex = -1
  profiles.forEach((profile, index) => {
    if (profile.qualification.tier !== 'full-context-tested') return
    const previous = profiles[recommendedIndex]
    if (!previous || Number(profile.options.vision) > Number(previous.options.vision)
      || (profile.options.vision === previous.options.vision && profile.concurrency < previous.concurrency)) {
      recommendedIndex = index
    }
  })
  const visibleIndices = profiles.flatMap((_, index) =>
    showAll || index === recommendedIndex || index === selectedIndex ? [index] : [])
  return { recommendedIndex, visibleIndices }
}
