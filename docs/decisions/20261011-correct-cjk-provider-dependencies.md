# Correct CJK dependency provider metadata

OI-105 completes the approved release dependency alignment without changing
SDK, React, parser, Vitest, CJK adapters or package versions. Three published
parents omit dependencies required by their children. Use Yarn's existing
[packageExtensions](https://yarnpkg.com/configuration/yarnrc#packageExtensions)
to supply unified^11 to @streamdown/cjk1.0.2 and micromark^4 to each
remark-cjk-friendly1.2.3 parent. These selectors are exact versions; their child
peer requirements and optional type peers stay intact.

The existing lock resolves unified11.0.5 and micromark4.0.2. Both lockfiles and
package checksums remain unchanged. This repairs the actual provider graph,
not an observed runtime import failure. Warnings are neither suppressed nor
made optional. All368 peer groups, an offline immutable install and one real
Chat CJK emphasis/strikethrough case pass. The separate short-message renderer
bypass stays on the master list.

Normal Linux/Windows install scripts consume the root configuration. A custom
runner that skips installation must qualify its cached physical graph against
this configuration before using it. This is source acceptance, not release or
publication. Evidence: /ai/gchat/out/oi105-cjk-metadata-20261011/.
