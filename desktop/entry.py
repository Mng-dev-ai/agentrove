import os
from pathlib import Path
from urllib.parse import urlparse

import uvicorn
from migrate import check_and_run_migrations


def _load_desktop_env() -> None:
    # Load <data_dir>/.env.desktop into the environment before the app reads settings.
    # data_dir is the parent of STORAGE_PATH (set by desktop.rs); inline env still wins.
    storage = os.environ.get("STORAGE_PATH")
    if not storage:
        return
    env_file = Path(storage).parent / ".env.desktop"
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    os.environ.setdefault("DESKTOP_MODE", "true")
    _load_desktop_env()
    os.chdir(Path(__file__).resolve().parent)
    check_and_run_migrations()

    base_url = os.environ.get("BASE_URL", "http://127.0.0.1:8081")
    parsed = urlparse(base_url)
    port = parsed.port or 8081

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        workers=1,
        log_level="info",
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
