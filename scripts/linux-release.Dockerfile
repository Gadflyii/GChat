FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential make git python3 nodejs pkg-config libgtk-3-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    libssl-dev libxdo-dev patchelf curl wget file squashfs-tools \
    ca-certificates xdg-utils desktop-file-utils && rm -rf /var/lib/apt/lists/*
# Mount an explicit Rust toolchain/cache and Yarn 4.5.3 at build invocation.
ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH
RUN printf '#!/bin/sh\nexec node /opt/yarn/yarn.js "$@"\n' > /usr/local/bin/yarn \
    && chmod +x /usr/local/bin/yarn
WORKDIR /work
