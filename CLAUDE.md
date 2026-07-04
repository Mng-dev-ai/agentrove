# CLAUDE.md

Backend-specific rules (Python, FastAPI, SQLAlchemy, testing) live in `backend/CLAUDE.md`; frontend-specific rules (React, performance, UI/UX) live in `frontend/CLAUDE.md`.

## Project Context

- `frontend/backend-sidecar/` is a build artifact — never edit; all backend source lives in `backend/`
- Open-source self-hosted app for single-user / small-team use — single API instance, no distributed workers or multi-replica coordination
- No distributed-system patterns (distributed locks, cross-instance heartbeats, consensus) — prefer in-process state (in-memory sets/dicts, asyncio tasks)
- Redis is for pub/sub and caching only — not a task broker or coordination layer
- Background work runs as asyncio tasks in the API process
- Treat per-user request handling as effectively sequential — don't flag bugs that only appear under overlapping concurrent requests (retries, double-submit, multi-tab) unless the task explicitly asks for concurrency hardening
- ACP `field_meta` (`_meta`) is extensibility metadata agents aren't required to read — don't use it for user-facing data; if ACP has no first-class field for a concept, it can't be reliably done through metadata

## Minimalism

- Choose the smallest fix — don't refactor or add abstractions as part of a bug fix; prefer a one-line guard over reworked control flow
- Don't optimize for "no regressions" or long-term resilience unless asked — favor simple, direct changes over defensive scaffolding
- Don't build elaborate rollback/state-restoration for failure paths — log + best-effort recovery (e.g., re-queue) is sufficient
- Don't add resource cleanup (`try/finally` with `.cleanup()`/`.close()`) for short-lived provider/client objects — GC handles lazy clients (e.g., `aiodocker.Docker`); only add cleanup for long-lived or pooled objects
- Don't add pre-flight compatibility checks when a natural fallback exists — let it fall through instead of branching to re-route
- Validate at the boundary only — if an API endpoint checks a value, downstream functions receiving it shouldn't re-validate
- Prefer the simplest collection op (e.g., `list.insert(0, item)` over a sorted-insertion loop when order doesn't matter)
- Don't add backward-compat paths, fallback paths, or legacy shims unless asked
- Don't create type aliases with no semantic value (e.g., `StreamKind = str`)
- Don't handle hypothetical input shapes — code for the format you've observed (logs, tests, types), not branches for unseen structures
- Avoid no-op pass-through wrappers; wrappers must add concrete value (validation, transformation, error handling, compatibility boundary, stable public API)
- Don't extract a utility file for a single constant/expression duplicated across only 2 call sites — inline until 3+ sites or an existing file fits naturally
- Don't create standalone functions that only wrap a single dict lookup with a default — inline `DICT[key].field` or `DICT.get(key)`; for tuples, use a `NamedTuple`
- Don't create inline dict literals for identity mappings — use a module-level `frozenset` membership check

## Completion Quality Gate

- No dead code left behind — remove unused functions, exports, imports, constants, types, files, and stale wrappers in the same task
- Every task includes a final dead-code sweep across touched areas and new files
- Before finishing, verify:
  - New symbols are referenced (or intentionally public and documented)
  - Replaced symbols are removed and references updated
- If something is intentionally left unused for compatibility, state that explicitly in the final summary

## Verification

- Don't run tests, lints, type checks, or similar verification commands unless explicitly asked

## Code Style

### Comments
- Never use docstrings (`"""..."""`) — always use inline `#` comments
- Always comment non-obvious logic, implicit conventions, design decisions — comment the *why*, never the *what*
- Keep comments short — 1–2 lines max. If it needs more, simplify the code or move detail to the PR description
- Don't delete existing comments without asking — they may capture context not obvious from the code
- Prefer clear names over comments when code is self-explanatory
- No decorative section comments (e.g., `# ── Section ──────`)
- Place comments inside methods/classes, not above them — method comments are the first line in the body, explaining *why* and context (not restating the name)
- Good: `# Read from the API host, not the sandbox — sandbox containers don't have the user's global git config`
- Bad (restates name): `# Yield persisted events after a given seq`

### Cross-cutting gotchas
- When two methods in the same class share a lifecycle (one always calls the other), don't duplicate work in the caller that the callee already performs
- When refactoring `try/catch/finally`, preserve cleanup in `finally` — don't move cleanup after an `await` without wrapping in `try/finally`
- When a caller passes a value to a function that already stores/registers it, don't call a second function to store/register it again
- When adding new operations in a domain that already accepts a context/targeting parameter (e.g., `cwd`), propagate it through the full chain — backend endpoint, frontend service, React Query hook, UI component
- In shell command chains, use `&&` to gate dependent steps and wrap independent cleanup in `{ ...; }` when exit status must reflect earlier failures
- When a shell/CLI command interpolates a path, confirm the cwd matches the path's basis — mixing repo-root-relative pathspecs with a nested cwd silently scopes operations wrong
- When adding a bulk variant of a per-item operation, mirror every edge case (initial state, missing ref, newly-added vs tracked entries)

## Naming Conventions

- Method names describe intent, not mechanism (`_consume_stream` not `_iterate_events`)
- Be concrete, not vague (`_save_final_snapshot` not `_persist_final_state`; `_close_redis` not `_cleanup_redis`)
- Keep names short when meaning holds (`_try_create_checkpoint` not `_create_checkpoint_if_needed`)
- Don't put implementation details in public method names (`execute_chat` not `execute_chat_with_managed_resources`)
- Use consistent terminology within a module — don't mix synonyms (pick "cancel" or "revoke", not both)
- Don't prefix module-level constants with `_` — leading underscores are for private class methods/instance vars only

## Code Review Guidelines

### What to fix
- Bugs that break user-visible behavior (wrong event ordering, dropped messages, stale UI state)
- Correctness issues that silently continue into broken state (e.g., swallowed errors leaving client/server out of sync)
- Missing TTL/expiry on Redis keys that can leak forever
- Dead code left behind by the change (unused imports, unreachable branches, orphaned constants)

### What to skip
- Orphaned DB rows from unlikely failure paths — a stray empty message row is harmless in a single-user app
- Hypothetical compatibility mismatches when a natural fallback already handles the case
- Anything the Project Context and Minimalism sections already exempt (concurrency edge cases, state-restoration rollback)

### Callback closure analysis
- When reviewing React hooks, event handlers, or async stream callbacks, verify which render created the callback before concluding what props/state it closes over
- Don't infer a closure bug from a helper being parameterized by the current prop/state value unless you've traced creation site, storage, and which instance is invoked later
- Callbacks stored outside React render flow (refs, Zustand stores, event listeners, stream registries, service singletons) are snapshots of the render that created them — they don't track the currently visible screen or latest hook inputs
- Before flagging cross-chat/cross-screen/cross-context state contamination, trace the full lifecycle: creation site, captured values, storage location, update path, invocation site

### Failure-path control flow
- When reviewing error handling, trace the exact path an exception takes through `except`, `raise`, and `return` boundaries before concluding later code is affected
- Don't flag success-path classification logic as buggy unless you've verified execution can still reach it after the failure
- In async call chains, follow the failure across helper methods and outer handlers all the way to the final state write

### Complexity test
Ask: "If this fails, does the user lose data or get stuck?" If no (orphaned row, briefly stale UI), skip. If yes (queued message silently dropped, stream appears frozen), fix.
