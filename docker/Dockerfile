# Setup base image
FROM ubuntu:noble-20251013 AS base

# Build arguments
ARG ARG_UID=1000
ARG ARG_GID=1000

FROM base AS build-arm64
RUN echo "Preparing build of AnythingLLM image for arm64 architecture"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Use a nearby mirror by default for reliable cold builds in China. Override
# this build argument when another Ubuntu ports mirror is preferable.
ARG UBUNTU_PORTS_MIRROR=http://mirrors.aliyun.com/ubuntu-ports
RUN sed -i -E \
    "s#https?://ports.ubuntu.com/ubuntu-ports#${UBUNTU_PORTS_MIRROR}#g" \
    /etc/apt/sources.list.d/ubuntu.sources

# Install system dependencies
# hadolint ignore=DL3008,DL3013
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -yq --no-install-recommends \
        unzip curl gnupg libgfortran5 tzdata netcat-openbsd poppler-utils \
        libc6 libcairo2 libexpat1 libfontconfig1 libgcc1 libglib2.0-0 libpango-1.0-0 \
        ca-certificates fonts-liberation git build-essential pkg-config libcairo2-dev libpango1.0-dev \
        libjpeg-dev libgif-dev librsvg2-dev ffmpeg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    # Install node and yarn
    apt-get install -yq --no-install-recommends nodejs && \
    curl -LO https://github.com/yarnpkg/yarn/releases/download/v1.22.19/yarn_1.22.19_all.deb \
        && dpkg -i yarn_1.22.19_all.deb \
        && rm yarn_1.22.19_all.deb && \
    # Install uvx (pinned to 0.6.10) for MCP support
    curl -LsSf https://astral.sh/uv/0.6.10/install.sh | sh && \
        mv /root/.local/bin/uv /usr/local/bin/uv && \
        mv /root/.local/bin/uvx /usr/local/bin/uvx && \
        echo "Installed uvx! $(uv --version)" && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create a group and user with specific UID and GID
# First, remove any existing user/group with the target UID/GID to avoid conflicts
RUN (getent passwd "$ARG_UID" && userdel -f "$(getent passwd "$ARG_UID" | cut -d: -f1)") || true && \
    (getent group "$ARG_GID" && groupdel "$(getent group "$ARG_GID" | cut -d: -f1)") || true && \
    groupadd -g "$ARG_GID" anythingllm && \
    useradd -l -u "$ARG_UID" -m -d /app -s /bin/bash -g anythingllm anythingllm && \
    mkdir -p /app/frontend/ /app/server/ /app/collector/ && chown -R anythingllm:anythingllm /app

# Copy docker helper scripts
COPY ./docker/docker-entrypoint.sh /usr/local/bin/
COPY ./docker/docker-healthcheck.sh /usr/local/bin/
COPY --chown=anythingllm:anythingllm ./docker/.env.example /app/server/.env

# Ensure the scripts are executable
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-healthcheck.sh

#############################################

# amd64-specific stage
FROM base AS build-amd64
RUN echo "Preparing build of AnythingLLM image for non-ARM architecture"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Use a nearby mirror by default for reliable cold builds in China. Override
# this build argument when another Ubuntu mirror is preferable.
ARG UBUNTU_MIRROR=http://mirrors.aliyun.com/ubuntu
RUN sed -i -E \
    "s#https?://(archive|security).ubuntu.com/ubuntu#${UBUNTU_MIRROR}#g" \
    /etc/apt/sources.list.d/ubuntu.sources

# Install system dependencies
# hadolint ignore=DL3008,DL3013
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -yq --no-install-recommends \
        unzip curl gnupg libgfortran5 tzdata netcat-openbsd poppler-utils \
        libc6 libcairo2 libexpat1 libfontconfig1 libgcc1 libglib2.0-0 libpango-1.0-0 \
        ca-certificates fonts-liberation git build-essential pkg-config libcairo2-dev libpango1.0-dev \
        libjpeg-dev libgif-dev librsvg2-dev ffmpeg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    # Install node and yarn
    apt-get install -yq --no-install-recommends nodejs && \
    curl -LO https://github.com/yarnpkg/yarn/releases/download/v1.22.19/yarn_1.22.19_all.deb \
        && dpkg -i yarn_1.22.19_all.deb \
        && rm yarn_1.22.19_all.deb && \
    # Install uvx (pinned to 0.6.10) for MCP support
    curl -LsSf https://astral.sh/uv/0.6.10/install.sh | sh && \
        mv /root/.local/bin/uv /usr/local/bin/uv && \
        mv /root/.local/bin/uvx /usr/local/bin/uvx && \
        echo "Installed uvx! $(uv --version)" && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create a group and user with specific UID and GID
# First, remove any existing user/group with the target UID/GID to avoid conflicts
RUN (getent passwd "$ARG_UID" && userdel -f "$(getent passwd "$ARG_UID" | cut -d: -f1)") || true && \
    (getent group "$ARG_GID" && groupdel "$(getent group "$ARG_GID" | cut -d: -f1)") || true && \
    groupadd -g "$ARG_GID" anythingllm && \
    useradd -l -u "$ARG_UID" -m -d /app -s /bin/bash -g anythingllm anythingllm && \
    mkdir -p /app/frontend/ /app/server/ /app/collector/ && chown -R anythingllm:anythingllm /app

# Copy docker helper scripts
COPY ./docker/docker-entrypoint.sh /usr/local/bin/
COPY ./docker/docker-healthcheck.sh /usr/local/bin/
COPY --chown=anythingllm:anythingllm ./docker/.env.example /app/server/.env

# Ensure the scripts are executable
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-healthcheck.sh

#############################################
# COMMON BUILD FLOW FOR ALL ARCHS
#############################################

# hadolint ignore=DL3006
FROM build-${TARGETARCH} AS build
RUN echo "Running common build flow of AnythingLLM image for all architectures"

USER anythingllm
WORKDIR /app

# Install & Build frontend layer
# Use BUILDPLATFORM to run on the native host architecture (not emulated).
# This avoids esbuild crashing under QEMU when cross-compiling.
# The output (static HTML/CSS/JS) is platform-independent.
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend-build
WORKDIR /app/frontend
ARG YARN_REGISTRY=https://registry.npmmirror.com
COPY ./frontend/package.json ./frontend/yarn.lock ./
RUN sed -i \
      -e "s#https://registry.yarnpkg.com#${YARN_REGISTRY}#g" \
      -e "s#https://registry.npmjs.org#${YARN_REGISTRY}#g" \
      yarn.lock && \
    yarn install --network-timeout 100000 && yarn cache clean
ARG VITE_AGENT_TRANSPORT=auto
ENV VITE_AGENT_TRANSPORT=$VITE_AGENT_TRANSPORT
COPY ./frontend/ ./
RUN yarn build
WORKDIR /app

# Install server dependencies before copying server source so ordinary code
# changes do not invalidate the expensive dependency layer.
FROM build AS backend-build
WORKDIR /app/server
ARG YARN_REGISTRY=https://registry.npmmirror.com
ARG TARGETARCH
ARG VSCODE_RIPGREP_PACKAGE_VERSION=1.17.1
ARG VSCODE_RIPGREP_RELEASE=v15.0.1
COPY --chown=anythingllm:anythingllm ./server/package.json ./server/yarn.lock ./
# @vscode/ripgrep normally discovers this asset through GitHub's anonymous
# Releases API during postinstall. Seed its documented cache from the direct
# release URL so cold builds do not fail when the shared API quota is exhausted.
RUN case "$TARGETARCH" in \
      amd64) ripgrep_target=x86_64-unknown-linux-musl ;; \
      arm64) ripgrep_target=aarch64-unknown-linux-musl ;; \
      *) echo "Unsupported ripgrep build architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    ripgrep_asset="ripgrep-${VSCODE_RIPGREP_RELEASE}-${ripgrep_target}.tar.gz" && \
    ripgrep_cache="/tmp/vscode-ripgrep-cache-${VSCODE_RIPGREP_PACKAGE_VERSION}" && \
    mkdir -p "$ripgrep_cache" && \
    curl -fsSL --retry 4 --retry-all-errors \
      "https://github.com/microsoft/ripgrep-prebuilt/releases/download/${VSCODE_RIPGREP_RELEASE}/${ripgrep_asset}" \
      -o "$ripgrep_cache/$ripgrep_asset"
# Yarn 1 installs both glibc and musl LanceDB optional packages on Linux.
# Ubuntu uses glibc, so retain only the native package for the target CPU.
RUN sed -i \
      -e "s#https://registry.yarnpkg.com#${YARN_REGISTRY}#g" \
      -e "s#https://registry.npmjs.org#${YARN_REGISTRY}#g" \
      yarn.lock && \
    yarn install --production --frozen-lockfile --network-timeout 100000 && \
    case "$TARGETARCH" in \
      amd64) lancedb_native_package=lancedb-linux-x64-gnu ;; \
      arm64) lancedb_native_package=lancedb-linux-arm64-gnu ;; \
      *) echo "Unsupported LanceDB build architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    find node_modules/@lancedb -mindepth 1 -maxdepth 1 -type d \
      -name 'lancedb-*' ! -name "$lancedb_native_package" -exec rm -rf {} + && \
    test -d "node_modules/@lancedb/$lancedb_native_package" && \
    node -e "require('@lancedb/lancedb')" && \
    yarn cache clean

# Install collector dependencies before copying either source tree so this
# layer remains cached when only server source changes.
WORKDIR /app/collector
COPY --chown=anythingllm:anythingllm ./collector/package.json ./collector/yarn.lock ./
RUN sed -i \
      -e "s#https://registry.yarnpkg.com#${YARN_REGISTRY}#g" \
      -e "s#https://registry.npmjs.org#${YARN_REGISTRY}#g" \
      yarn.lock && \
    yarn install --production --network-timeout 100000 && yarn cache clean

# Source-only layers come after all dependency layers.
COPY --chown=anythingllm:anythingllm ./server/ /app/server/
COPY --chown=anythingllm:anythingllm ./collector/ /app/collector/
COPY --chown=anythingllm:anythingllm ./agent-config/ /app/agent-config/

WORKDIR /app
USER anythingllm

# Since we are building from backend-build we just need to move built frontend into server/public
FROM backend-build AS production-build
WORKDIR /app
COPY --chown=anythingllm:anythingllm --from=frontend-build /app/frontend/dist /app/server/public

# Setup the environment
ENV NODE_ENV=production
ENV ANYTHING_LLM_RUNTIME=docker
ENV DEPLOYMENT_VERSION=1.15.0

# Setup the healthcheck
HEALTHCHECK --interval=1m --timeout=10s --start-period=1m \
  CMD /bin/bash /usr/local/bin/docker-healthcheck.sh || exit 1

# Run the server
# CMD ["sh", "-c", "tail -f /dev/null"] # For development: keep container open
ENTRYPOINT ["/bin/bash", "/usr/local/bin/docker-entrypoint.sh"]
