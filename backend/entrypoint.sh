#!/bin/sh

ensure_docker_network() {
    if [ ! -S /var/run/docker.sock ]; then
        return
    fi

    NETWORK_NAME="${DOCKER_NETWORK:-}"
    if [ -z "$NETWORK_NAME" ]; then
        # Prefer the compose "sandbox" network this container is already on so
        # production and Coolify PR previews stay isolated without a fixed name.
        CONTAINER_ID="$(hostname)"
        NETWORK_NAME="$(
            docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$CONTAINER_ID" 2>/dev/null \
                | grep -E 'sandbox' \
                | head -n 1 \
                || true
        )"
    fi
    if [ -z "$NETWORK_NAME" ]; then
        NETWORK_NAME="agentrove-sandbox-net"
    fi

    export DOCKER_NETWORK="$NETWORK_NAME"
    if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
        echo "Creating Docker network: $NETWORK_NAME"
        docker network create "$NETWORK_NAME" 2>/dev/null || true
    else
        echo "Using Docker network: $NETWORK_NAME"
    fi
}

echo "Running database migrations..."
cd /app && python migrate.py || exit 1

ensure_docker_network

echo "Starting API server..."
if [ -S /var/run/docker.sock ]; then
    echo "Docker socket detected, running as current user for Docker access..."
    exec sh -c "ulimit -s 65536 && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --log-level info --no-proxy-headers"
else
    exec gosu appuser sh -c "ulimit -s 65536 && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --log-level info --no-proxy-headers"
fi
