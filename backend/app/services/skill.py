import base64
import json
import logging
import shutil
import stat as stat_module
import tempfile
from pathlib import Path

from app.core.config import get_settings
from app.models.schemas.skills import SkillFileEntry
from app.models.types import CustomSkillDict
from app.services.acp.adapters import AgentKind
from app.utils.yaml_parser import YAMLParser

logger = logging.getLogger(__name__)
settings = get_settings()

SKILL_MD_FILENAME = "SKILL.md"


class SkillService:
    def __init__(self, workspace_path: Path | None = None) -> None:
        self.paths_by_source, self.readonly_paths = self._build_paths_by_source(
            workspace_path
        )

    @staticmethod
    def _namespace_paths(
        workspace_path: Path | None, base: Path, namespaces: list[str]
    ) -> list[Path]:
        # Workspace paths come first (per-namespace) so they take priority over globals.
        paths: list[Path] = []
        if workspace_path:
            paths.extend(workspace_path / f".{ns}" / "skills" for ns in namespaces)
        paths.extend(base / f".{ns}" / "skills" for ns in namespaces)
        return paths

    @staticmethod
    def _build_paths_by_source(
        workspace_path: Path | None,
    ) -> tuple[dict[str, list[Path]], set[Path]]:
        # Desktop mode reads from the user's home dir, server mode from STORAGE_PATH.
        base = Path.home() if settings.DESKTOP_MODE else Path(settings.STORAGE_PATH)
        ns = SkillService._namespace_paths

        # .{name}/skills namespaces each agent searches. Codex/Copilot/Cursor share
        # the Vercel .agents/skills ecosystem; OpenCode additionally cross-reads
        # Claude-compatible skills.
        result: dict[str, list[Path]] = {
            AgentKind.CODEX.value: ns(workspace_path, base, ["codex", "agents"]),
            AgentKind.COPILOT.value: ns(workspace_path, base, ["copilot", "agents"]),
            AgentKind.CURSOR.value: ns(workspace_path, base, ["cursor", "agents"]),
            AgentKind.CLAUDE.value: ns(workspace_path, base, ["claude"]),
            AgentKind.OPENCODE.value: ns(
                workspace_path, base, ["opencode", "agents", "claude"]
            ),
        }
        readonly_paths: set[Path] = set()

        # Cursor CLI ships built-in skills at ~/.cursor/skills-cursor/ and manages
        # that directory automatically (updates overwrite user edits), so we
        # surface those skills but flag them read-only.
        cursor_builtin = base / ".cursor" / "skills-cursor"
        result[AgentKind.CURSOR.value].append(cursor_builtin)
        readonly_paths.add(cursor_builtin)

        # Claude plugins can also bundle skills.
        result[AgentKind.CLAUDE.value].extend(
            SkillService._get_claude_plugin_skill_paths()
        )

        return result, readonly_paths

    @staticmethod
    def _get_claude_plugin_skill_paths() -> list[Path]:
        # Claude-specific: cross-reference ~/.claude/settings.json (enabled flags)
        # with installed_plugins.json (install paths) to discover plugin-bundled skills.
        claude_dir = Path.home() / ".claude"
        settings_path = claude_dir / "settings.json"
        installed_path = claude_dir / "plugins" / "installed_plugins.json"
        if not settings_path.is_file() or not installed_path.is_file():
            return []
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            installed = json.loads(installed_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return []
        enabled_plugins = settings.get("enabledPlugins", {})
        # Plugin IDs use the format "plugin-name@marketplace"
        enabled_ids = {
            pid for pid, enabled in enabled_plugins.items() if enabled is True
        }
        if not enabled_ids:
            return []
        paths: list[Path] = []
        for plugin_id, installs in installed.get("plugins", {}).items():
            if plugin_id not in enabled_ids:
                continue
            for entry in installs:
                install_path = entry.get("installPath")
                if not install_path:
                    continue
                skills_dir = Path(install_path) / "skills"
                if skills_dir.is_dir():
                    paths.append(skills_dir)
        return paths

    @staticmethod
    def _compute_dir_stats(directory: Path) -> tuple[int, int]:
        file_count = 0
        total_size = 0
        for f in directory.rglob("*"):
            try:
                st = f.stat()
            except OSError:
                continue
            if stat_module.S_ISREG(st.st_mode):
                file_count += 1
                total_size += st.st_size
        return file_count, total_size

    def _find_skill_dir(self, source: str, skill_name: str) -> Path | None:
        for base_path in self.paths_by_source.get(source, []):
            skill_dir = base_path / skill_name
            if skill_dir.is_dir() and (skill_dir / SKILL_MD_FILENAME).exists():
                return skill_dir
        return None

    def list_all(self) -> list[CustomSkillDict]:
        skills: list[CustomSkillDict] = []
        for source, paths in self.paths_by_source.items():
            seen_names: set[str] = set()
            for base_path in paths:
                if not base_path.is_dir():
                    continue
                is_readonly = base_path in self.readonly_paths
                for entry in base_path.iterdir():
                    if not entry.is_dir() or entry.name in seen_names:
                        continue
                    skill_md = entry / SKILL_MD_FILENAME
                    if not skill_md.exists():
                        continue
                    try:
                        content = skill_md.read_text(encoding="utf-8")
                    except (OSError, UnicodeDecodeError):
                        continue
                    try:
                        metadata = YAMLParser.parse(content)
                    except ValueError:
                        metadata = {}
                    file_count, total_size = self._compute_dir_stats(entry)
                    skills.append(
                        {
                            "name": entry.name,
                            "description": str(metadata.get("description", "")),
                            "size_bytes": total_size,
                            "file_count": file_count,
                            "source": source,
                            "read_only": is_readonly,
                        }
                    )
                    seen_names.add(entry.name)
        return skills

    def get_files(self, source: str, skill_name: str) -> list[SkillFileEntry]:
        # Text files are returned as-is, binary files as base64-encoded strings.
        skill_dir = self._find_skill_dir(source, skill_name)
        if skill_dir is None:
            raise FileNotFoundError(f"Skill '{skill_name}' not found")

        files: list[SkillFileEntry] = []
        for file_path in sorted(skill_dir.rglob("*")):
            if not file_path.is_file():
                continue
            rel_path = str(file_path.relative_to(skill_dir))
            try:
                content = file_path.read_text(encoding="utf-8")
                files.append(
                    SkillFileEntry(path=rel_path, content=content, is_binary=False)
                )
            except UnicodeDecodeError:
                encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
                files.append(
                    SkillFileEntry(path=rel_path, content=encoded, is_binary=True)
                )
        return files

    def update(
        self,
        source: str,
        skill_name: str,
        files: list[SkillFileEntry],
    ) -> CustomSkillDict:
        # Atomic update: writes to a temp dir first, validates SKILL.md metadata,
        # then replaces the original so the skill is untouched if validation fails.
        skill_dir = self._find_skill_dir(source, skill_name)
        if skill_dir is None:
            raise FileNotFoundError(f"Skill '{skill_name}' not found")

        # Reject edits under CLI-managed directories (e.g. ~/.cursor/skills-cursor)
        # where an external tool would silently overwrite user changes.
        if skill_dir.parent in self.readonly_paths:
            raise ValueError(f"Skill '{skill_name}' is read-only and cannot be edited")

        with tempfile.TemporaryDirectory() as tmp_dir_str:
            tmp_dir = Path(tmp_dir_str) / skill_name
            tmp_dir.mkdir()
            tmp_dir_resolved = tmp_dir.resolve()

            for entry in files:
                dest = (tmp_dir / entry.path).resolve()
                if not dest.is_relative_to(tmp_dir_resolved):
                    raise ValueError(f"Invalid file path: {entry.path}")
                dest.parent.mkdir(parents=True, exist_ok=True)
                if entry.is_binary:
                    dest.write_bytes(base64.b64decode(entry.content))
                else:
                    dest.write_text(entry.content, encoding="utf-8")

            metadata = YAMLParser.parse(
                (tmp_dir / SKILL_MD_FILENAME).read_text(encoding="utf-8")
            )
            file_count, total_size = self._compute_dir_stats(tmp_dir)

            shutil.rmtree(skill_dir)
            shutil.copytree(tmp_dir, skill_dir)

        return {
            "name": skill_name,
            "description": str(metadata.get("description", "")),
            "size_bytes": total_size,
            "file_count": file_count,
            "source": source,
            "read_only": skill_dir.parent in self.readonly_paths,
        }
