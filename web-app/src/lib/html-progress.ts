export function estimateHtmlProgress(code: string): number {
  if (!code) return 0.04

  const has = (re: RegExp) => re.test(code)
  if (has(/<\/html>/i)) return 1
  if (has(/<\/body>/i)) return 0.95

  let base = 0.06
  let ceil = 0.18
  if (has(/<!doctype|<html[\s>]/i)) {
    base = 0.12
    ceil = 0.3
  }
  if (has(/<head[\s>]/i)) {
    base = 0.22
    ceil = 0.45
  }
  if (has(/<\/head>/i)) {
    base = 0.45
    ceil = 0.6
  }
  if (has(/<body[\s>]/i)) {
    base = 0.6
    ceil = 0.92
  }

  // Asymptotic creep toward (but never reaching) the next milestone.
  const creep = 1 - 1 / (1 + code.length / 2200)
  return Math.min(ceil, base + (ceil - base) * creep)
}
