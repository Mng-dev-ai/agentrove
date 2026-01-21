# You can use most Debian-based base images
FROM e2bdev/base:latest

# Install dependencies and customize sandbox
RUN apt-get update && apt-get install -y \
    zip \
    unzip \
    lsof \
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    tree \
    jq \
    python3 \
    python3-pip \
    build-essential \
    xz-utils \
    gnupg \
    ca-certificates \
    rsync \
    xvfb \
    x11vnc \
    websockify \
    x11-xserver-utils \
    xdotool \
    && curl -LO https://github.com/BurntSushi/ripgrep/releases/download/13.0.0/ripgrep_13.0.0_amd64.deb \
    && dpkg -i ripgrep_13.0.0_amd64.deb \
    && rm ripgrep_13.0.0_amd64.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Chromium browser
RUN apt-get update \
    && apt-get install -y chromium --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSLO https://nodejs.org/dist/v20.19.0/node-v20.19.0-linux-x64.tar.xz \
    && mkdir -p /usr/local/lib/nodejs \
    && tar -xJf node-v20.19.0-linux-x64.tar.xz -C /usr/local/lib/nodejs \
    && rm node-v20.19.0-linux-x64.tar.xz \
    && ln -sf /usr/local/lib/nodejs/node-v20.19.0-linux-x64/bin/node /usr/local/bin/node \
    && ln -sf /usr/local/lib/nodejs/node-v20.19.0-linux-x64/bin/npm /usr/local/bin/npm \
    && ln -sf /usr/local/lib/nodejs/node-v20.19.0-linux-x64/bin/npx /usr/local/bin/npx \
    && npm config set prefix /usr/local \
    && npm install -g create-vite vite wrangler bun \
    && echo '#!/bin/sh\nexec bun x "$@"' > /usr/local/bin/bunx \
    && chmod +x /usr/local/bin/bunx

RUN npm install -g @anthropic-ai/claude-code@2.1.14

RUN pip3 install anthropic-bridge==0.1.19

RUN npm install -g @openai/codex

RUN npm install -g @z_ai/mcp-server

# Install OpenVSCode Server for full IDE experience
RUN OPENVSCODE_VERSION="1.105.1" && \
    curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/openvscode-server-v${OPENVSCODE_VERSION}-linux-x64.tar.gz" | \
    tar -xz -C /opt && \
    mv /opt/openvscode-server-v${OPENVSCODE_VERSION}-linux-x64 /opt/openvscode-server && \
    ln -s /opt/openvscode-server/bin/openvscode-server /usr/local/bin/openvscode-server

# Install Python MCP dependencies (official SDK) and uv (provides uvx)
RUN pip3 install --no-cache-dir mcp redis httpx uv

# Copy shared scripts
COPY permission_server.py /usr/local/bin/permission_server.py
COPY start-vnc.sh /usr/local/bin/start-vnc.sh
RUN chmod +x /usr/local/bin/start-vnc.sh

RUN curl -LO https://go.dev/dl/go1.23.3.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.23.3.linux-amd64.tar.gz \
    && rm go1.23.3.linux-amd64.tar.gz

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

RUN curl -fsSL https://get.docker.com | sh && \
    (id -u user &>/dev/null && usermod -aG docker user || true) && \
    mkdir -p /etc/docker && \
    echo '{"storage-driver": "vfs"}' > /etc/docker/daemon.json

ENV PATH="/usr/local/bin:/usr/local/lib/nodejs/node-v20.19.0-linux-x64/bin:/usr/local/go/bin:/root/.cargo/bin:${PATH}"

RUN export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
