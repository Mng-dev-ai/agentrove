FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/home/user
ENV PATH="/home/user/.local/bin:/home/user/.nvm/versions/node/v20.18.0/bin:$PATH"
ENV NVM_DIR="/home/user/.nvm"
ENV NODE_VERSION=20.18.0
ENV TERM=xterm-256color

RUN apt-get update && apt-get install -y \
    curl \
    git \
    unzip \
    zip \
    build-essential \
    software-properties-common \
    sudo \
    openssh-client \
    jq \
    tmux \
    ripgrep \
    ca-certificates \
    gnupg \
    file \
    vim \
    nano \
    wget \
    less \
    tree \
    fd-find \
    procps \
    psmisc \
    lsof \
    rsync \
    patch \
    iproute2 \
    netcat-openbsd \
    dnsutils \
    && ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y python3.12 python3.12-venv python3.12-dev \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.12 1 \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.12 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) \
        curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb; \
        apt-get update; \
        apt-get install -y /tmp/google-chrome.deb fonts-liberation fonts-noto-color-emoji; \
        google-chrome --version; \
        rm /tmp/google-chrome.deb \
        ;; \
      arm64) \
        : \
        ;; \
      *) exit 1 ;; \
    esac; \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://get.docker.com | sh && \
    mkdir -p /etc/docker && \
    echo '{"storage-driver": "vfs"}' > /etc/docker/daemon.json

RUN useradd -m -s /bin/bash -u 1000 user && \
    echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user && \
    chmod 0440 /etc/sudoers.d/user && \
    usermod -aG docker user && \
    chown -R user:user /home/user

COPY --chmod=755 sandbox/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN set -eux; \
    version=20260818_01_RC01; \
    case "$(uname -m)" in \
      x86_64|amd64) platform=linux-x86_64 ;; \
      aarch64|arm64) platform=linux-arm64 ;; \
      *) exit 1 ;; \
    esac; \
    mkdir -p /opt/antigravity /home/user/.local/bin; \
    curl -fsSL "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_${version}-${platform}.zip" \
      -o /tmp/antigravity.zip; \
    unzip /tmp/antigravity.zip -d /opt/antigravity; \
    rm /tmp/antigravity.zip; \
    chmod +x /opt/antigravity/agy_acp_server.par /opt/antigravity/localharness_external; \
    printf '#!/bin/sh\nexec /opt/antigravity/agy_acp_server.par --uid= "$@"\n' \
      > /home/user/.local/bin/agy-acp-server; \
    chmod +x /home/user/.local/bin/agy-acp-server; \
    chown -R user:user /opt/antigravity /home/user/.local

EXPOSE 3000 3001 5000 8000 8080 5173 4200 8888 4321 3030 5500 1234 4000

USER user
WORKDIR /home/user

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install $NODE_VERSION && \
    nvm use $NODE_VERSION && \
    nvm alias default $NODE_VERSION

RUN . "$NVM_DIR/nvm.sh" && \
    npm install -g @anthropic-ai/claude-code@2.1.237 @agentclientprotocol/claude-agent-acp@0.70.0 @agentclientprotocol/codex-acp@1.6.0 @openai/codex@0.148.0 @github/copilot@1.0.80

# Cursor CLI — pinned download replicating cursor.com/install (which always
# fetches its own latest); cursor-agent lands in ~/.local/bin, already on PATH.
RUN set -eux; \
    v=2026.08.11-e8db854; \
    case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) exit 1;; esac; \
    dir=/home/user/.local/share/cursor-agent/versions/$v; \
    mkdir -p "$dir" /home/user/.local/bin; \
    curl -fsSL "https://downloads.cursor.com/lab/$v/linux/$arch/agent-cli-package.tar.gz" \
      | tar --strip-components=1 -xz -C "$dir"; \
    ln -sf "$dir/cursor-agent" /home/user/.local/bin/cursor-agent; \
    ln -sf "$dir/cursor-agent" /home/user/.local/bin/agent

# OpenCode CLI (installs `opencode` to ~/.opencode/bin; symlink into ~/.local/bin
# so the ACP binary resolves without modifying PATH). Pinned: the unpinned path
# resolves "latest" via the rate-limited GitHub API.
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version 1.18.18 && \
    mkdir -p /home/user/.local/bin && \
    ln -sf /home/user/.opencode/bin/opencode /home/user/.local/bin/opencode

# Grok Build CLI — download static binary into ~/.local/bin (already on PATH).
# Avoid install.sh: it targets ~/.grok/bin and is awkward under non-root USER.
RUN set -eux; \
    version="$(curl -fsSL https://x.ai/cli/stable)"; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64|amd64) arch=x86_64 ;; \
      aarch64|arm64) arch=aarch64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    mkdir -p /home/user/.local/bin; \
    curl -fsSL "https://x.ai/cli/grok-${version}-linux-${arch}" -o /home/user/.local/bin/grok; \
    chmod +x /home/user/.local/bin/grok

RUN python3 -m pip install --user --upgrade pip && \
    python3 -m pip install --user \
    uv

RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) \
        uv tool install --python python3.12 'browser-use[cli]==0.13.8'; \
        browser-use --version \
        ;; \
      arm64) \
        : \
        ;; \
      *) exit 1 ;; \
    esac

RUN echo '#!/bin/bash\nexec echo $GITHUB_TOKEN' > /home/user/.git-askpass.sh && \
    chmod +x /home/user/.git-askpass.sh

RUN echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

RUN mkdir -p /home/user/.claude && \
    mkdir -p /home/user/.checkpoints

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/bin/bash"]
