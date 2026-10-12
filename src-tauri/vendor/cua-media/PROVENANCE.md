# Cua native RPC client

Source: Gadflyii/cua, SDK revision
`0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc`, `libs/cua`.
MIT `LICENSE.md` retained. This slice contains `cua-proto`, the proto contracts,
and `cua-spacesd-client`; the workspace manifest retains only their dependency
closure. No production protocol or client behavior changes.

The testing-only mock records `OpenMedia`/`CloseMedia` requests and allows the
focused fixture to name its dedicated display. Those additions do not compile
into the release client. GChat owns its scoped media lease and SSH proxy.
