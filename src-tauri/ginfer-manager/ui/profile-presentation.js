export function profileEvidenceLabel(tier) {
  return tier === 'full-context-tested' ? 'Tested'
    : tier === 'calculated-startup-smoke' ? 'Estimated' : 'Untested'
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
