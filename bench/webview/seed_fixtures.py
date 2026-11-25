import argparse
import asyncio
import json
import os
import random
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, insert, select

from app.db.session import SessionLocal, engine
from app.models.db_models import (  # noqa: F401
    automation,
    channel,
    refresh_token,
)
from app.models.db_models.chat import Chat, Message
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace

MODEL_ID = "claude-opus-5-5"
SIDEBAR_CHATS = 400
SWITCH_SIZE = 200
DIFF_FILES = 60
CORPUS_DIRS = ("frontend/src", "backend/app")
CODE_SUFFIXES = {".ts": "ts", ".tsx": "tsx", ".py": "python", ".scss": "scss"}
PROSE_FILES = ("README.md", "AGENTS.md")
TITLE_VERBS = (
    "Fix",
    "Investigate",
    "Refactor",
    "Add",
    "Review",
    "Optimize",
    "Debug",
    "Document",
    "Remove",
    "Migrate",
)
TITLE_OBJECTS = (
    "sidebar unread badge",
    "SSE reconnect backoff",
    "diff view word wrap",
    "token refresh race",
    "channel feed ordering",
    "workspace picker",
    "Alembic migration for checkpoints",
    "Grok adapter modes",
    "terminal resize flicker",
    "MCP route allowlist",
    "message pagination cursor",
    "Tauri updater signature",
    "queue banner layout",
    "prompt suggestions parsing",
    "sub-thread report delivery",
    "dark theme contrast",
)
USER_PROMPTS = (
    "Can you look at why {obj} misbehaves after a reconnect? Check the hooks first.",
    "Run the backend checks and fix whatever {obj} broke.",
    "Please refactor {obj} so the state lives in one place, keep the diff small.",
    "Why is {obj} slow on a chat with a long history? Measure before changing.",
    "Review the last commit touching {obj} and tell me if anything looks wrong.",
    "Add a regression test for {obj} and make it pass.",
)
BASH_COMMANDS = (
    ("git status -sb", "Show working tree status"),
    ("git log --oneline -15", "Show recent commits"),
    ("cd backend && ruff check . && ruff format --check .", "Lint backend"),
    ("cd frontend && npm run typecheck", "Typecheck frontend"),
    ("rg -n 'useChatScroll' frontend/src | head -40", "Search scroll hook usages"),
    ("cd backend && pytest tests/test_chat.py -q -x", "Run chat tests"),
    ("git diff --stat origin/main...HEAD", "Show branch diff stat"),
)


class Corpus:
    def __init__(self, repo: Path, rng: random.Random) -> None:
        self.rng = rng
        self.repo = repo
        self.code_files = sorted(
            p
            for d in CORPUS_DIRS
            for p in (repo / d).rglob("*")
            if p.is_file()
            and p.suffix in CODE_SUFFIXES
            and "node_modules" not in p.parts
            and ".test." not in p.name
        )
        prose = " ".join(
            (repo / name).read_text(encoding="utf-8") for name in PROSE_FILES
        )
        prose = re.sub(r"[`#*|>\[\]()]", "", prose)
        self.sentences = [
            s.strip()
            for s in re.split(r"(?<=[.!?])\s+", prose.replace("\n", " "))
            if 40 <= len(s.strip()) <= 260
        ]
        self.lines_cache: dict[Path, list[str]] = {}

    def lines(self, path: Path) -> list[str]:
        if path not in self.lines_cache:
            self.lines_cache[path] = path.read_text(encoding="utf-8").splitlines()
        return self.lines_cache[path]

    def rel(self, path: Path) -> str:
        return path.relative_to(self.repo).as_posix()

    def prose(self, low: int, high: int) -> str:
        return " ".join(self.rng.sample(self.sentences, self.rng.randint(low, high)))

    def snippet(self, low: int, high: int) -> tuple[Path, int, list[str]]:
        path = self.rng.choice(self.code_files)
        lines = self.lines(path)
        size = min(len(lines), self.rng.randint(low, high))
        start = self.rng.randint(0, max(0, len(lines) - size))
        return path, start, lines[start : start + size]

    def title(self) -> str:
        return f"{self.rng.choice(TITLE_VERBS)} {self.rng.choice(TITLE_OBJECTS)}"


class TurnBuilder:
    def __init__(self, corpus: Corpus, rng: random.Random, repo_root: str) -> None:
        self.corpus = corpus
        self.rng = rng
        self.repo_root = repo_root

    def tool_id(self) -> str:
        return "toolu_01" + "".join(
            self.rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789")
            for _ in range(22)
        )

    def user_text(self, obj: str) -> str:
        text = self.rng.choice(USER_PROMPTS).format(obj=obj)
        if self.rng.random() < 0.3:
            text += "\n\n" + self.corpus.prose(2, 6)
        return text

    def tool_pair(self, name: str, title: str, tool_input: dict[str, Any], result: Any):
        tool_id = self.tool_id()
        started = {
            "id": tool_id,
            "name": name,
            "title": title,
            "status": "started",
            "parent_id": None,
            "input": tool_input,
        }
        completed = {**started, "status": "completed", "result": result}
        if "file_path" in tool_input:
            started["path"] = completed["path"] = tool_input["file_path"]
        return [
            {"type": "tool_started", "tool": started},
            {"type": "tool_completed", "tool": completed},
        ]

    def bash_tool(self) -> list[dict[str, Any]]:
        command, description = self.rng.choice(BASH_COMMANDS)
        _, _, lines = self.corpus.snippet(5, 40)
        return self.tool_pair(
            "Bash",
            command,
            {"command": command, "description": description},
            "\n".join(lines),
        )

    def read_tool(self) -> list[dict[str, Any]]:
        path, start, lines = self.corpus.snippet(40, 200)
        file_path = f"{self.repo_root}/{self.corpus.rel(path)}"
        numbered = "\n".join(
            f"{start + i + 1:>6}\t{line}" for i, line in enumerate(lines)
        )
        return self.tool_pair(
            "Read", f"Read {file_path}", {"file_path": file_path}, numbered
        )

    def edit_tool(self) -> list[dict[str, Any]]:
        path, _, lines = self.corpus.snippet(4, 18)
        file_path = f"{self.repo_root}/{self.corpus.rel(path)}"
        old = "\n".join(lines)
        new = "\n".join(
            line.replace("const ", "const next").replace("return ", "return  ")
            for line in lines
        )
        return self.tool_pair(
            "Edit",
            f"Edit {self.corpus.rel(path)}",
            {
                "replace_all": False,
                "file_path": file_path,
                "old_string": old,
                "new_string": new,
            },
            f"The file {file_path} has been updated successfully.",
        )

    def search_tool(self) -> list[dict[str, Any]]:
        hits = [
            f"{self.corpus.rel(p)}:{self.rng.randint(1, 400)}:"
            f"{self.rng.choice(self.corpus.lines(p) or [''])}"
            for p in self.rng.sample(self.corpus.code_files, self.rng.randint(4, 20))
        ]
        query = self.rng.choice(("useChatScroll", "patchChatInCache", "stream_id"))
        return self.tool_pair(
            "Grep",
            f'grep "{query}"',
            {"pattern": query, "output_mode": "content", "-n": True},
            "\n".join(hits),
        )

    def markdown_answer(self) -> str:
        path, start, lines = self.corpus.snippet(20, 110)
        lang = CODE_SUFFIXES[path.suffix]
        rel = self.corpus.rel(path)
        parts = [
            self.corpus.prose(2, 4),
            f"## What changed in `{rel}`",
            "\n".join(
                f"- {self.corpus.prose(1, 1)}" for _ in range(self.rng.randint(3, 6))
            ),
            f"```{lang}\n" + "\n".join(lines) + "\n```",
            self.corpus.prose(2, 5),
        ]
        if self.rng.random() < 0.35:
            rows = "\n".join(
                f"| `{self.corpus.rel(p)}` | {self.rng.randint(1, 90)} "
                f"| {self.rng.randint(0, 40)} |"
                for p in self.rng.sample(self.corpus.code_files, 5)
            )
            parts.append(f"| File | Added | Removed |\n|---|---:|---:|\n{rows}")
        if self.rng.random() < 0.4:
            parts.append(
                f"See [{rel}](file://{self.repo_root}/{rel}#L{start + 1}) for the rest."
            )
        return "\n\n".join(parts)

    def assistant_events(self, session_id: str) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = [
            {"type": "system", "data": {"session_id": session_id}},
            {"type": "assistant_thinking", "thinking": self.corpus.prose(2, 8)},
        ]
        tools = (self.bash_tool, self.read_tool, self.edit_tool, self.search_tool)
        for _ in range(self.rng.choice((0, 1, 2, 3, 4, 6, 8))):
            events.extend(self.rng.choice(tools)())
            if self.rng.random() < 0.3:
                events.append(
                    {"type": "assistant_text", "text": self.corpus.prose(1, 2) + "\n"}
                )
        events.append({"type": "assistant_text", "text": self.markdown_answer()})
        if self.rng.random() < 0.5:
            events.append(
                {
                    "type": "prompt_suggestions",
                    "suggestions": [self.corpus.title() for _ in range(3)],
                }
            )
        return events


class FixtureSeeder:
    def __init__(self, repo: Path, work_dir: Path, seed: int) -> None:
        self.repo = repo
        self.work_dir = work_dir
        self.rng = random.Random(seed)
        self.corpus = Corpus(repo, self.rng)
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.message_rows = 0
        self.message_bytes = 0

    @staticmethod
    def git(cwd: Path, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
        ).stdout

    def build_repo(self, name: str, files: list[Path]) -> Path:
        root = self.work_dir / name
        if root.exists():
            shutil.rmtree(root)
        for path in files:
            target = root / self.corpus.rel(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        root.mkdir(parents=True, exist_ok=True)
        self.git(root, "init", "-q", "-b", "main")
        self.git(
            root, "remote", "add", "origin", f"https://github.com/bench/{name}.git"
        )
        self.git(root, "add", "-A")
        self.git(
            root,
            "-c",
            "user.name=bench",
            "-c",
            "user.email=bench@example.com",
            "commit",
            "-q",
            "-m",
            "base",
        )
        return root

    def mutate_file(self, path: Path) -> None:
        lines = path.read_text(encoding="utf-8").splitlines()
        for _ in range(self.rng.randint(3, 6)):
            if len(lines) < 4:
                break
            at = self.rng.randint(0, len(lines) - 1)
            span = min(len(lines) - at, self.rng.randint(2, 12))
            replacement = [
                line.replace("const ", "let ").replace("def ", "async def ") + "  "
                for line in lines[at : at + span]
            ]
            _, _, extra = self.corpus.snippet(2, 14)
            lines[at : at + span] = replacement + extra
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def build_diff_worktree(self, root: Path) -> dict[str, int]:
        worktree = root / ".worktrees" / "bench-diff"
        (root / ".git" / "info" / "exclude").write_text(".worktrees/\n")
        self.git(root, "worktree", "add", "-q", "-b", "bench-diff", str(worktree))
        tracked = sorted(
            p for p in worktree.rglob("*") if p.is_file() and ".git" not in p.parts
        )
        for path in self.rng.sample(tracked, DIFF_FILES):
            self.mutate_file(path)
        added_lines = 0
        for index in range(4):
            _, _, lines = self.corpus.snippet(60, 160)
            new_file = worktree / "frontend" / "src" / "bench" / f"added_{index}.ts"
            new_file.parent.mkdir(parents=True, exist_ok=True)
            new_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
            added_lines += len(lines)
        numstat = [
            row.split("\t")
            for row in self.git(worktree, "diff", "--numstat", "HEAD").splitlines()
        ]
        return {
            "modified_files": len(numstat),
            "untracked_files": 4,
            "added_lines": sum(int(row[0]) for row in numstat) + added_lines,
            "removed_lines": sum(int(row[1]) for row in numstat),
        }

    async def insert_workspace(self, db: Any, user: User, name: str, path: Path):
        workspace = Workspace(
            name=name,
            user_id=user.id,
            sandbox_id=uuid.uuid4().hex[:12],
            sandbox_provider="host",
            workspace_path=str(path),
            source_type="local",
        )
        db.add(workspace)
        await db.flush()
        return workspace

    async def insert_chat(
        self,
        db: Any,
        user: User,
        workspace: Workspace,
        title: str,
        message_count: int,
        updated_at: datetime,
        worktree_cwd: str | None = None,
    ) -> tuple[uuid.UUID, uuid.UUID]:
        chat_id = uuid.uuid4()
        session_id = str(uuid.uuid4())
        await db.execute(
            insert(Chat).values(
                id=chat_id,
                title=title,
                user_id=user.id,
                workspace_id=workspace.id,
                session_id=session_id,
                session_agent_kind="claude",
                worktree_cwd=worktree_cwd,
                last_model_id=MODEL_ID,
                last_permission_mode="auto",
                last_thinking_mode="medium",
                last_persona_name="Agent",
                created_at=updated_at - timedelta(seconds=30 * message_count + 60),
                updated_at=updated_at,
                last_viewed_at=updated_at + timedelta(seconds=1),
            )
        )
        builder = TurnBuilder(self.corpus, self.rng, str(workspace.workspace_path))
        obj = title.split(" ", 1)[1]
        rows: list[dict[str, Any]] = []
        message_id = uuid.uuid4()
        for index in range(message_count):
            created = updated_at - timedelta(seconds=30 * (message_count - index))
            if index % 2 == 0:
                text = builder.user_text(obj)
                render = {"events": [{"type": "user_text", "text": text}]}
                row = {"role": "user", "content_text": text, "model_id": MODEL_ID}
            else:
                events = builder.assistant_events(session_id)
                text = "".join(
                    e["text"] for e in events if e["type"] == "assistant_text"
                )
                render = {"events": events}
                row = {
                    "role": "assistant",
                    "content_text": text,
                    "model_id": MODEL_ID,
                    "session_id": session_id,
                    "total_cost_usd": round(self.rng.uniform(0.01, 1.8), 4),
                    "duration_ms": self.rng.randint(4_000, 240_000),
                }
            self.message_bytes += len(json.dumps(render))
            message_id = uuid.uuid4()
            rows.append(
                {
                    **row,
                    "id": message_id,
                    "chat_id": chat_id,
                    "content_render": render,
                    "stream_status": "completed",
                    "created_at": created,
                    "updated_at": created,
                }
            )
            if len(rows) >= 500:
                await db.execute(insert(Message), rows)
                rows = []
        if rows:
            await db.execute(insert(Message), rows)
        self.message_rows += message_count
        return chat_id, message_id

    async def seed(self, admin_email: str) -> dict[str, Any]:
        main_files = self.corpus.code_files
        agentrove_root = self.build_repo("agentrove", main_files)
        diff_stats = self.build_diff_worktree(agentrove_root)
        side_roots = [
            self.build_repo(name, self.rng.sample(main_files, 40))
            for name in ("aux-nexus", "aux-dotcom")
        ]
        async with SessionLocal() as db:
            user = (
                await db.execute(select(User).where(User.email == admin_email))
            ).scalar_one()
            main_ws = await self.insert_workspace(db, user, "agentrove", agentrove_root)
            side_ws = [
                await self.insert_workspace(db, user, root.name, root)
                for root in side_roots
            ]
            all_ws = [main_ws, *side_ws]
            chats: dict[str, dict[str, Any]] = {}
            for index in range(SIDEBAR_CHATS):
                await self.insert_chat(
                    db,
                    user,
                    self.rng.choice(all_ws),
                    self.corpus.title(),
                    self.rng.choice((2, 2, 4, 6)),
                    self.now - timedelta(hours=2 + index * 3),
                )
            named = (
                ("switch_b", "Bench B: review queue card spacing", SWITCH_SIZE, None),
                ("switch_a", "Bench A: tune stream reconnect", SWITCH_SIZE, None),
                (
                    "chat_diff",
                    "Bench diff: rework editor tabs",
                    6,
                    ".worktrees/bench-diff",
                ),
                ("chat_5k", "Bench 5k: chase pagination drift", 5000, None),
                ("chat_1k", "Bench 1k: audit session refresh", 1000, None),
            )
            for offset, (key, title, count, cwd) in enumerate(named):
                chat_id, last_message_id = await self.insert_chat(
                    db,
                    user,
                    main_ws,
                    title,
                    count,
                    self.now - timedelta(minutes=50 - offset * 10),
                    cwd,
                )
                chats[key] = {
                    "id": str(chat_id),
                    "title": title,
                    "messages": count,
                    "last_message_id": str(last_message_id),
                }
            await db.commit()
            chat_total = (await db.execute(select(func.count(Chat.id)))).scalar_one()
        await engine.dispose()
        return {
            "user_id": str(user.id),
            "workspace_id": str(main_ws.id),
            "sandbox_id": main_ws.sandbox_id,
            "chats": chats,
            "sizes": {
                "chats_total": chat_total,
                "sidebar_filler_chats": SIDEBAR_CHATS,
                "messages_total": self.message_rows,
                "message_render_json_bytes": self.message_bytes,
                "named_chat_messages": {k: v["messages"] for k, v in chats.items()},
                "diff": diff_stats,
                "db_bytes": 0,
            },
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20261124)
    args = parser.parse_args()
    seeder = FixtureSeeder(args.repo.resolve(), args.work_dir.resolve(), args.seed)
    fixture = asyncio.run(seeder.seed(os.environ["ADMIN_EMAIL"]))
    db_path = Path(os.environ["DATABASE_URL"].split("///", 1)[1])
    fixture["sizes"]["db_bytes"] = db_path.stat().st_size
    args.out.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    json.dump(fixture["sizes"], sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
