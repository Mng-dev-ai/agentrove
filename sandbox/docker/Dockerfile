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
    openssh-client \
    jq \
    tmux \
    ripgrep \
    ca-certificates \
    gnupg \
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

RUN curl -fsSL https://get.docker.com | sh && \
    mkdir -p /etc/docker && \
    echo '{"storage-driver": "vfs"}' > /etc/docker/daemon.json

RUN useradd -m -s /bin/bash -u 1000 user && \
    usermod -aG docker user && \
    chown -R user:user /home/user

COPY --chmod=755 sandbox/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 3000 3001 5000 8000 8080 5173 4200 8888 4321 3030 5500 1234 4000

USER user
WORKDIR /home/user

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install $NODE_VERSION && \
    nvm use $NODE_VERSION && \
    nvm alias default $NODE_VERSION

RUN . "$NVM_DIR/nvm.sh" && \
    npm install -g @anthropic-ai/claude-code@2.1.119 @agentclientprotocol/claude-agent-acp@0.54.1 @zed-industries/codex-acp@0.15.0 @openai/codex@0.125.0 @github/copilot@1.0.36

# Cursor CLI (installs `cursor-agent` to ~/.local/bin, which is already on PATH).
RUN curl -fsS https://cursor.com/install | bash

# OpenCode CLI (installs `opencode` to ~/.opencode/bin; symlink into ~/.local/bin
# so the ACP binary resolves without modifying PATH).
RUN curl -fsSL https://opencode.ai/install | bash && \
    mkdir -p /home/user/.local/bin && \
    ln -sf /home/user/.opencode/bin/opencode /home/user/.local/bin/opencode

RUN python3 -m pip install --user --upgrade pip && \
    python3 -m pip install --user \
    uv

RUN echo '#!/bin/bash\nexec echo $GITHUB_TOKEN' > /home/user/.git-askpass.sh && \
    chmod +x /home/user/.git-askpass.sh

RUN echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

RUN mkdir -p /home/user/.claude && \
    mkdir -p /home/user/.checkpoints

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/bin/bash"]
