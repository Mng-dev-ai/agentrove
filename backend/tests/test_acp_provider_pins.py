import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST = REPO_ROOT / "scripts" / "acp-providers.env"
BUMP_SCRIPT = REPO_ROOT / "scripts" / "bump-acp-providers.sh"
DOCKERFILES = ("backend/Dockerfile", "sandbox/docker/Dockerfile")
DESKTOP_BUILD = "desktop/run_build.mjs"
# Manifest key -> the text every consumer writes directly before that version.
PIN_PREFIXES = {
    "CLAUDE_CODE_VERSION": "@anthropic-ai/claude-code@",
    "CLAUDE_AGENT_ACP_VERSION": "@agentclientprotocol/claude-agent-acp@",
    "CODEX_ACP_VERSION": "@agentclientprotocol/codex-acp@",
    "CODEX_VERSION": "@openai/codex@",
    "COPILOT_VERSION": "@github/copilot@",
    "OPENCODE_VERSION": "opencode.ai/v2/install | bash -s -- --version ",
    "CURSOR_VERSION": "downloads.cursor.com/lab/",
    "ANTIGRAVITY_VERSION": "agy-acp-server-",
    "GROK_VERSION": "x.ai/cli/grok-",
}
DESKTOP_KEYS = ("CLAUDE_CODE_VERSION", "CLAUDE_AGENT_ACP_VERSION", "CODEX_ACP_VERSION")


def assert_pins_come_from_manifest(
    consumer: str, keys: tuple[str, ...], reference: str
) -> None:
    text = (REPO_ROOT / consumer).read_text()
    for key in keys:
        prefix = PIN_PREFIXES[key]
        sourced = re.escape(prefix) + '"?' + re.escape(reference.format(key=key))
        assert prefix in text, f"{consumer} no longer installs {key}"
        assert text.count(prefix) == len(re.findall(sourced, text)), (
            f"{consumer} pins {key} without reading {MANIFEST.name}"
        )


def test_manifest_holds_a_version_for_every_provider() -> None:
    pins = dict(line.split("=") for line in MANIFEST.read_text().splitlines())

    assert pins.keys() == PIN_PREFIXES.keys()
    for key, version in pins.items():
        assert re.fullmatch(r"[0-9][0-9A-Za-z.-]*", version), key


@pytest.mark.parametrize("dockerfile", DOCKERFILES)
def test_dockerfile_reads_every_pin_from_the_manifest(dockerfile: str) -> None:
    text = (REPO_ROOT / dockerfile).read_text()

    assert "COPY scripts/acp-providers.env /opt/acp-providers.env\n" in text
    assert_pins_come_from_manifest(dockerfile, tuple(PIN_PREFIXES), "${{{key}:?}}")


def test_desktop_build_reads_its_pins_from_the_manifest() -> None:
    text = (REPO_ROOT / DESKTOP_BUILD).read_text()

    assert "join(rootDir, 'scripts', 'acp-providers.env')" in text
    for key in DESKTOP_KEYS:
        assert not re.search(rf"\b{key}\s*=", text), f"{key} is hardcoded"
    assert_pins_come_from_manifest(DESKTOP_BUILD, DESKTOP_KEYS, "${{{key}}}")


def test_bump_script_fails_when_the_manifest_lacks_a_key(tmp_path: Path) -> None:
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    script = shutil.copy(BUMP_SCRIPT, scripts)
    manifest = scripts / MANIFEST.name
    without_grok = "".join(
        line
        for line in MANIFEST.read_text().splitlines(keepends=True)
        if not line.startswith("GROK_VERSION=")
    )
    manifest.write_text(without_grok)

    result = subprocess.run(
        ["bash", script], capture_output=True, text=True, timeout=30
    )

    assert result.returncode != 0
    assert "has no GROK_VERSION pin" in result.stderr
    assert manifest.read_text() == without_grok
