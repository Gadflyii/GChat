export function profileEvidenceLabel(tier: string): 'Tested' | 'Estimated' | 'Untested'

export function profilePresentation(profiles: readonly {
  qualification: { tier: string }
  options: { vision: boolean }
  concurrency: number
}[], selectedIndex: number, showAll: boolean): {
  recommendedIndex: number
  visibleIndices: number[]
}
