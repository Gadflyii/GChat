export function profileEvidenceLabel(tier) {
  return tier === 'full-context-tested' ? 'Full conversations tested'
    : tier === 'screened-startup' ? 'Short conversations tested'
    : tier === 'calculated-startup-smoke' ? 'Memory estimated; short conversations tested' : 'Not yet tested'
}

export function profileOptionLabel(profile, recommended) {
  const context = profile.max_context % 1024 === 0
    ? `${profile.max_context / 1024}K` : profile.max_context.toLocaleString()
  return `${recommended ? 'Recommended · ' : ''}${profileEvidenceLabel(profile.qualification.tier)} · ${profile.concurrency} replies at once · ${context} tokens · ${profile.options.vision ? 'Images and text' : 'Text only'}`
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
