FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/home/user
ENV PATH="/home/user/.local/bin:/home/user/.nvm/versions/node/v20.18.0/bin:$PATH"
ENV NVM_DIR="/home/user/.nvm"
ENV NODE_VERSION=20.18.0
ENV TERM=xterm-256color
ENV DISPLAY=:99
ENV OPENVSCODE_PORT=8765

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    rsync \
    unzip \
    zip \
    build-essential \
    software-properties-common \
    sudo \
    openssh-client \
    jq \
    htop \
    vim \
    nano \
    ca-certificates \
    gnupg \
    iproute2 \
    xvfb \
    x11vnc \
    websockify \
    x11-xserver-utils \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    xdotool \
    && add-apt-repository -y ppa:xtradeb/apps \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y chromium --no-install-recommends \
    && apt-get install -y python3.11 python3.11-venv python3.11-dev \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11 \
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
    echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    usermod -aG docker user && \
    chown -R user:user /home/user

COPY e2b/permission_server.py /usr/local/bin/permission_server.py
RUN chmod +x /usr/local/bin/permission_server.py

USER user
WORKDIR /home/user

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install $NODE_VERSION && \
    nvm use $NODE_VERSION && \
    nvm alias default $NODE_VERSION

RUN . "$NVM_DIR/nvm.sh" && \
    npm install -g @anthropic-ai/claude-code@2.1.14 @openai/codex

RUN python3 -m pip install --user --upgrade pip && \
    python3 -m pip install --user \
    uv \
    httpx \
    requests \
    pydantic \
    mcp \
    anthropic-bridge==0.1.19

RUN OPENVSCODE_VERSION="1.105.1" && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        ARCH_SUFFIX="arm64"; \
    else \
        ARCH_SUFFIX="x64"; \
    fi && \
    curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/openvscode-server-v${OPENVSCODE_VERSION}-linux-${ARCH_SUFFIX}.tar.gz" | \
    tar -xz -C /tmp && \
    sudo mv /tmp/openvscode-server-v${OPENVSCODE_VERSION}-linux-${ARCH_SUFFIX} /opt/openvscode-server && \
    sudo ln -s /opt/openvscode-server/bin/openvscode-server /usr/local/bin/openvscode-server

RUN echo '#!/bin/bash\nexec echo $GITHUB_TOKEN' > /home/user/.git-askpass.sh && \
    chmod +x /home/user/.git-askpass.sh

RUN echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

RUN mkdir -p /home/user/.claude && \
    mkdir -p /home/user/.checkpoints

EXPOSE 3000 3001 5000 5900 6080 8000 8080 8765 5173 4200 8888 4321 3030 5500 1234 4000

COPY e2b/start-vnc.sh /usr/local/bin/start-vnc.sh
RUN sudo chmod +x /usr/local/bin/start-vnc.sh

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sudo chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/bin/bash"]
