FROM python:3.12-slim

# Create a non-root user because claude-code causes permission issues when using bypassPermissions mode
# see https://github.com/anthropics/claude-code-sdk-python/issues/30
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev curl git gnupg \
    ca-certificates \
    gosu docker-cli \
    build-essential \
    openssh-client && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@2.1.119 @agentclientprotocol/claude-agent-acp@0.38.0 @zed-industries/codex-acp@0.15.0 @openai/codex@0.125.0 @github/copilot@1.0.36

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

# Install uv package manager
RUN curl -LsSf https://astral.sh/uv/install.sh | bash

COPY backend/requirements.lock .

RUN /root/.local/bin/uv pip install --system --no-cache -r requirements.lock

COPY backend/ /app/

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
