export function profileEvidenceLabel(tier: string): 'Full conversations tested' | 'Short conversations tested' | 'Memory estimated; short conversations tested' | 'Not yet tested'

export function profileOptionLabel(profile: {
  qualification: { tier: string }
  options: { vision: boolean }
  concurrency: number
  max_context: number
}, recommended: boolean): string

export function profilePresentation(profiles: readonly {
  qualification: { tier: string }
  options: { vision: boolean }
  concurrency: number
}[], selectedIndex: number, showAll: boolean): {
  recommendedIndex: number
  visibleIndices: number[]
}
