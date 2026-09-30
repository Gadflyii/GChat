FROM node:22.22.1-bookworm-slim AS node
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential make git python3 pkg-config libgtk-3-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    libssl-dev libxdo-dev patchelf curl wget file squashfs-tools \
    ca-certificates xdg-utils desktop-file-utils && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# Mount an explicit Rust toolchain/cache and Yarn 4.5.3 at build invocation.
ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH
RUN printf '#!/bin/sh\nexec node /opt/yarn/yarn.js "$@"\n' > /usr/local/bin/yarn \
    && chmod +x /usr/local/bin/yarn
WORKDIR /work
