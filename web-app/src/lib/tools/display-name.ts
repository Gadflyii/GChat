export function toolDisplayName(name: string): string {
  const mcp = /^mcp_(.+)_[a-f0-9]{32}$/.exec(name)
  return mcp?.[1] ?? name
}
