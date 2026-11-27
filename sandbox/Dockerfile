FROM python:3.12.11-slim-bookworm

ARG SANDBOX_UID=1000
ARG SANDBOX_GID=1000
ARG DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security

RUN sed -i \
      -e "s#http://deb.debian.org/debian-security#${DEBIAN_SECURITY_MIRROR}#g" \
      -e "s#http://deb.debian.org/debian#${DEBIAN_MIRROR}#g" \
      -e 's/Components: main/Components: main contrib non-free non-free-firmware/g' \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      bzip2 \
      ca-certificates \
      coreutils \
      curl \
      diffutils \
      dnsutils \
      fd-find \
      file \
      fonts-noto-cjk \
      findutils \
      gawk \
      git \
      grep \
      gzip \
      iproute2 \
      iputils-ping \
      jq \
      less \
      libreoffice-writer \
      libreoffice-impress \
      libreoffice-draw \
      lsof \
      make \
      netcat-openbsd \
      openssh-client \
      openssl \
      pandoc \
      p7zip-full \
      patch \
      pkg-config \
      procps \
      poppler-utils \
      python3-dev \
      rar \
      ripgrep \
      rsync \
      sed \
      shellcheck \
      socat \
      sqlite3 \
      tar \
      tree \
      unrar \
      unzip \
      wget \
      xz-utils \
      yq \
      zip \
      zstd && \
    rm -rf /var/lib/apt/lists/* && \
    ln -s /usr/bin/fdfind /usr/local/bin/fd && \
    groupadd --gid "${SANDBOX_GID}" sandbox && \
    useradd --uid "${SANDBOX_UID}" --gid sandbox --no-create-home \
      --home-dir /tmp --shell /bin/bash sandbox

# Keep the expensive Python dependency layer independent from application code.
COPY pyproject.toml uv.lock /opt/anythingllm-sandbox/
# Preserve PIP_INDEX_URL / PIP_TRUSTED_HOST build arguments while installing via uv.
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=
RUN python3 -m pip install --no-cache-dir uv==0.12.7 && \
    UV_DEFAULT_INDEX="${PIP_INDEX_URL}" \
    UV_INSECURE_HOST="${PIP_TRUSTED_HOST}" \
    uv export --frozen --no-dev --no-emit-project \
      --directory /opt/anythingllm-sandbox \
      --output-file /tmp/runner-requirements.txt && \
    UV_DEFAULT_INDEX="${PIP_INDEX_URL}" \
    UV_INSECURE_HOST="${PIP_TRUSTED_HOST}" \
    uv pip install --system --no-cache --requirement /tmp/runner-requirements.txt && \
    rm -f /tmp/runner-requirements.txt /opt/anythingllm-sandbox/pyproject.toml /opt/anythingllm-sandbox/uv.lock

USER sandbox:sandbox
WORKDIR /workspace

ENV HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

CMD ["python3", "-I", "-B", "-"]
