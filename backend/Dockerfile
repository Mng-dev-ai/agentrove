FROM python:3.12-slim

# Create a non-root user because claude-code causes permission issues when using bypassPermissions mode
# see https://github.com/anthropics/claude-code-sdk-python/issues/30
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    # gh isn't in Debian's repos — add GitHub's apt source (needs curl, just installed)
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev git \
    gosu docker-cli \
    build-essential \
    openssh-client \
    gh ripgrep fd-find jq less tree unzip tmux \
    file vim nano wget procps psmisc lsof rsync patch \
    iproute2 netcat-openbsd dnsutils && \
    ln -s "$(command -v fdfind)" /usr/local/bin/fd && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@2.1.206 @agentclientprotocol/claude-agent-acp@0.59.0 @agentclientprotocol/codex-acp@1.1.4 @openai/codex@0.144.1 @github/copilot@1.0.36

# Cursor CLI (installs `cursor-agent` to /root/.local/bin) — used for the Cursor
# ACP server (`cursor-agent acp`). The install script downloads the binary for
# the current platform.
RUN curl -fsS https://cursor.com/install | bash && \
    cp /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent && \
    chmod +x /usr/local/bin/cursor-agent

# OpenCode CLI — used for the OpenCode ACP server (`opencode acp`). The install
# script downloads the binary to /root/.opencode/bin.
RUN curl -fsSL https://opencode.ai/install | bash && \
    cp /root/.opencode/bin/opencode /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

# Grok Build CLI — used for the Grok ACP server (`grok agent stdio`).
# Download the static binary directly: install.sh symlinks into /usr/local/bin
# then our old `cp -L` treats src/dest as the same file and exits 1.
RUN set -eux; \
    version="$(curl -fsSL https://x.ai/cli/stable)"; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64|amd64) arch=x86_64 ;; \
      aarch64|arm64) arch=aarch64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://x.ai/cli/grok-${version}-linux-${arch}" -o /usr/local/bin/grok; \
    chmod +x /usr/local/bin/grok

# Install uv package manager
RUN curl -LsSf https://astral.sh/uv/install.sh | bash

COPY backend/requirements.lock .

RUN /root/.local/bin/uv pip install --system --no-cache -r requirements.lock

COPY backend/ /app/

# Agentrove chat MCP server (mcp-server/server.py) lives at the repo root, not
# under backend/. The backend spawns it from /app/mcp-server/ (see MCP_SERVER_PATH
# in services/agent.py), so it must ship in the image — the desktop sidecar bundles
# it separately via run_build.mjs, but the cloud/VPS image needs it copied here.
COPY mcp-server/ /app/mcp-server/

RUN chown -R appuser:appuser /app && \
    chmod -R 755 /app && \
    chmod +x /app/entrypoint.sh

ENV HOME=/home/appuser
ENV PYTHONUNBUFFERED=1
ENV TERM=xterm-256color

RUN mkdir -p /data/agentrove/storage/images /data/agentrove/storage/pdfs /data/agentrove/storage/xlsx && \
    chown -R appuser:appuser /data/agentrove/storage

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
CMD []
