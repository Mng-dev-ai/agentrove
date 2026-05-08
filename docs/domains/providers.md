# Providers (ACP — Agent Client Protocol)

The abstraction over the five supported coding agents: **Claude, Codex, Copilot, Cursor, OpenCode**. Each ships as a CLI binary the backend launches and speaks to via the **Agent Client Protocol** (ACP) over stdio. One adapter per agent kind translates ACP semantics to/from the codebase's session config.

## Entry points

- Adapter registry: `backend/app/services/acp/adapters.py` — `AGENT_ADAPTERS[AgentKind]`, `NATIVE_FILE_TYPES`, session-mode mapping.
- Client / event handler: `backend/app/services/acp/client.py`.
- Session init: `backend/app/services/acp/session.py`.
- Orchestration: `backend/app/services/agent.py` — `AgentService.build_session_config()` produces `AcpSessionConfig`.
- Enum: `AgentKind` in `backend/app/models/db_models/enums.py`.

## Vocabulary

- **AgentKind** — enum: `claude`, `codex`, `copilot`, `cursor`, `opencode`.
- **AcpSessionConfig** — what the adapter receives: sandbox handle, cwd, system prompt, permission mode, thinking level, files.
- **`session_mode`** — ACP-level mode ID. Each agent has its own set:
  - **Claude** — `default`, `acceptEdits`, `bypassPermissions`, `plan` (mapped to UUIDs).
  - **Codex** — uses launch-time `approval_policy` (`auto` / `read-only` / `full-access`) instead of runtime modes.
  - **Copilot** — `agent`, `plan`, `autopilot`.
  - **Cursor** — `agent`, `plan`, `ask`.
  - **OpenCode** — `build`, `plan` (and the concept of *primary agents*).
- **`field_meta`** / **`_meta`** — optional ACP extensibility metadata. Some agents read `_meta.systemPrompt` for persona injection (Claude, Codex, Copilot). Cursor and OpenCode use other channels (OpenCode reads `OPENCODE_CONFIG_CONTENT` env var). **Don't put user-facing data in `_meta`** — agents aren't required to read it. (See `golden_principles.md` §1.)
- **Native file types** — what each agent inlines as base64 vs. what it consumes as sandbox-relative paths. From `NATIVE_FILE_TYPES`:
  - **Claude** — image + PDF inline.
  - **Codex** — image inline.
  - Others — image inline; PDFs and other types as paths.
- **Persona** — user-defined system prompt variant. Only **Claude / Codex / OpenCode** honor a replaced system prompt (PR #542). Cursor and Copilot ignore persona override.

## Cross-domain edges

- → **chat**: `Chat.session_agent_kind` selects the adapter. `permission_mode` and `thinking_mode` are chat-scoped (PR #396).
- → **sandbox**: agents launch inside the sandbox; `cwd` propagates through.
- → **streaming**: adapter events flow through `services/acp/client.py` → `services/streaming/runtime.py` → `StreamEnvelope` → SSE.
- → **workspace**: skills (`docs/domains/workspace.md`) are per-agent and resolve via filesystem scan (`.opencode/skills/`, `.cursor/`, etc.).

## Gotchas

- **Permission modes don't all mean the same thing.** Claude's `bypassPermissions` ≠ Codex's `full-access` — they translate at the adapter layer.
- **Thinking modes**: Claude uses ACP `effort` levels (low/med/high/xhigh — PR #538) plus an Opus xhigh tier. Other agents have their own.
- **Persona injection isn't universal.** Replacing the system prompt only works on adapters that support it. Show the persona selector accordingly (PR #542).
- **Codex uses model_instructions_file for persona** mode (PR #541) — different mechanism than `_meta.systemPrompt`.
- **OpenCode skills** are cross-read from shared skill directories (PR #537). Don't assume per-agent isolation everywhere.
- **Adapter processes can die.** The streaming runtime detects this and emits a stream `error` event. Don't add cross-process locks or restart logic — single process, best-effort recovery (`golden_principles.md` §1, §2).
- **Bundled in desktop builds** — see PR #591. Web mode runs from the sandbox image.
- **`AGENT_ADAPTERS` extension**: when adding a new agent kind, update the enum, the registry, the `NATIVE_FILE_TYPES` map, and the persona-support gate in one PR.

## Recent prior art

- **PR #591** — Bundle ACP adapters in desktop sidecar.
- **PR #589** — Remove agent auth env defaults. Read for: tightening adapter contract (no implicit fallbacks).
- **PR #528** — Add OpenCode CLI as a new ACP agent. Read for: full new-adapter PR shape.
- **PR #499** — Add GitHub Copilot CLI agent support. Read for: another full new-adapter precedent.
- **PR #542** — Gate personas to agents whose CLI honors a replaced system prompt. Read for: capability gating across providers.
- **PR #538** — Switch Claude thinking budget to ACP effort and add Opus xhigh tier.
- **PR #541** — Use model_instructions_file for Codex persona mode.
- **PR #465** — Refactor adapter pattern to data-returning abstract methods. Read for: the canonical adapter shape.
- **PR #537** — Show OpenCode skills and cross-read shared skill directories.
