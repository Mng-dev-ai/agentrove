# MyBox Agentrove Feature Audit

**Status:** current
**Date:** 2026-05-18
**Scope:** G0.5 feature audit for the MyBox Agentrove fork

---

## Purpose

This audit decides what MyBox should keep, change, remove, or defer from
Agentrove before product implementation starts.

The main conclusion is simple: MyBox should not replace Agentrove's core app.
Agentrove already contains the hard product primitives MyBox needs: multi-agent
ACP adapters, streaming event history, tool rendering, terminal, diffs, git,
workspaces, permissions, settings, and a desktop shell. MyBox should preserve
that base and add product-specific harness orchestration through small,
registry-backed layers.

## Decision Vocabulary

| Decision | Meaning |
| --- | --- |
| Keep | Preserve the existing Agentrove capability and build around it. |
| Change | Keep the underlying capability, but adapt product behavior or UX. |
| Remove | Do not carry this behavior into MyBox, or remove prior spike work. |
| Defer | Good direction, but not needed for the first production slice. |

## Highest-Level Verdict

| Area | Decision | Why |
| --- | --- | --- |
| Agentrove UI baseline | Keep | The user prefers the existing Agentrove look. It already feels closer to the desired Codex-like desktop app than prior custom MyBox shells. |
| ACP provider model | Keep | Existing adapters already cover Claude, Codex, Copilot, Cursor, and OpenCode. This is the right foundation for a multi-harness app. |
| MyBox custom skin spikes | Remove | The spike UIs looked out of place and should not be promoted into the fork. Preserve only evidence and lessons. |
| Forced hosted auth | Change | Useful for hosted Agentrove, but MyBox's local desktop mode needs a local-first path that does not block the app behind account sign-in. |
| OpenClaw integration | Defer live writes | Start read-only and truth-labeled. Live mutation belongs in a later, explicit safety slice. |

## Feature Audit

| Surface | Current Agentrove owner | MyBox decision | Rationale | Verification path |
| --- | --- | --- | --- | --- |
| Desktop shell | `frontend/src-tauri/`, `frontend/src/components/layout/TitleBar.tsx` | Keep | MyBox wants a native desktop control surface; Tauri host mode is already aligned with that direction. | Desktop build/smoke once dependencies are installed. |
| Main app layout | `frontend/src/pages/ChatPage.tsx`, `frontend/src/components/layout/*` | Keep, then extend | Sidebar, central chat/activity area, and review/diff side surfaces match the target app structure. | Browser or desktop screenshot review after each layout change. |
| Sidebar/project/thread model | `frontend/src/components/layout/Sidebar.tsx`, `SidebarChatItem.tsx`, `SubThreadList.tsx` | Keep | Thread lists, pinned chats, subthreads, and workspace grouping are core MyBox primitives. | Chat navigation smoke and visual review. |
| Landing/start screen | `frontend/src/pages/LandingPage.tsx` | Change | The current screen is Agentrove-oriented. MyBox needs a harness/workspace start screen, but should reuse the existing visual language. | Dedicated start-screen design review. |
| Chat model | `backend/app/models/db_models/chat.py`, `backend/app/services/chat.py`, `frontend/src/components/chat/chat-window/*` | Keep | Chat, messages, checkpoints, queueing, split panes, and session orchestration are central to MyBox. | Existing backend chat tests and browser conversation smoke. |
| Streaming event model | `backend/app/services/streaming/types.py`, `runtime.py`, `frontend/src/contexts/ChatContext.tsx` | Keep | `StreamEnvelope` and event snapshots are the right source for observable work history. | SSE reconnect and message event tests. |
| Thinking summaries | `frontend/src/components/chat/message-bubble/ThinkingBlock.tsx`, `segmentBuilder.ts` | Keep with policy | Show observable summaries only. Do not expose private chain-of-thought or invent hidden process data. | Message rendering tests and manual review. |
| Tool-call cards | `frontend/src/components/chat/tools/*` | Keep | Agentrove already has provider-specific tool renderers for Claude, Codex, Copilot, Cursor, and OpenCode. | Provider-specific tool fixture review. |
| Permission prompts | `frontend/src/components/chat/tools/ToolPermissionInline.tsx`, `frontend/src/components/ui/shared/ApprovalFooter.tsx` | Keep and elevate | Permission UX is essential for a trustworthy control surface. MyBox should add clearer risk/truth labels later. | Permission request fixture and browser smoke. |
| File editor/preview | `frontend/src/components/editor/*` | Keep | MyBox needs file inspection and edit context. Replacing this would create unnecessary risk. | Editor route smoke after product changes. |
| Diff/review surface | `frontend/src/components/sandbox/git/DiffView.tsx`, `PRReviewView.tsx` | Keep | This is a major reason to build on Agentrove. MyBox should refine, not replace, the review panel. | Git diff API plus visual review. |
| Terminal | `frontend/src/components/sandbox/terminal/*`, `backend/app/api/endpoints/websocket.py`, `backend/app/services/terminal.py` | Keep | The user explicitly wants an integrated terminal. Agentrove already has one. | Terminal websocket smoke. |
| Git operations | `backend/app/services/git.py`, `backend/app/api/endpoints/sandbox.py`, `frontend/src/components/chat/github/*` | Keep | Checkpoints, branch, diff, commit, push, pull, and restore are core agent-supervision controls. | Existing backend git tests plus local sandbox smoke. |
| Worktrees | `frontend/src/components/chat/worktree-selector/WorktreeToggle.tsx`, git service | Keep | Worktrees are valuable for safe multi-agent and multi-harness development. | Worktree creation and branch-state smoke. |
| Workspaces | `backend/app/services/workspace.py`, `backend/app/api/endpoints/workspace.py`, `frontend/src/components/chat/workspace-selector/*` | Keep | Workspaces are the MyBox project boundary. | Existing workspace tests. |
| Sandbox providers | `backend/app/services/sandbox_providers/*` | Keep | Host provider is especially important for local desktop MyBox. Docker can remain optional. | Provider-specific sandbox tests. |
| Skills | `backend/app/services/skill.py`, `frontend/src/components/settings/tabs/SkillsSettingsTab.tsx` | Keep | Skills map well to MyBox harness capabilities and per-workspace behavior. | Existing skills tests and settings smoke. |
| Slash commands | Workspace resources and input command panels | Keep | Slash commands are useful for harness-specific actions if capability-gated. | Command-panel smoke. |
| Personas/custom instructions | `frontend/src/components/chat/persona-selector/*`, settings tabs | Keep with capability gates | Useful, but not all providers support the same persona semantics. | Provider capability checks. |
| Model/thinking/permission selectors | `frontend/src/components/chat/*-selector/*` | Keep | These are already provider-aware and should feed the future harness registry. | Selector visual and state smoke. |
| Provider icons | `frontend/src/components/ui/icons/*` | Keep | Existing provider identity helps the harness switcher. Add OpenClaw later in the same style. | Icon inventory and visual review. |
| ACP adapters | `backend/app/services/acp/adapters.py`, `client.py`, `session.py` | Keep and extend | This is the major architectural asset. MyBox should add adapters through this boundary when possible. | Adapter launch probes and stream fixtures. |
| Harness registry | Not yet centralized for MyBox | Change | MyBox needs a data-driven registry of harnesses, capabilities, labels, and connection states. UI must not hardcode the harness list. | Registry tests once implemented. |
| OpenClaw adapter | Not present | Defer live, plan read-only | Start with read-only observed data and clear `READ-ONLY`/`OBSERVED` labels. No OpenClaw mutation in early MyBox. | Later read-only adapter probe. |
| Claude Code integration | Partly covered by Claude ACP | Change later | Existing Claude adapter may cover much of this. Claude Code-specific features should be researched before new transport. | Adapter capability comparison. |
| Codex integration | Existing Codex ACP adapter | Keep and harden later | Codex is first-class already. MyBox should verify history, streaming, tools, permissions, and diffs. | Codex adapter smoke. |
| OpenCode integration | Existing OpenCode adapter | Keep | Already listed as an Agentrove provider and useful for lower-cost execution. | OpenCode adapter smoke. |
| GitHub integration | `backend/app/services/github.py`, `frontend/src/components/chat/github/*` | Keep optional | Useful for review and PR workflows, but should not block local MyBox use. | Existing GitHub tests and capability-gated UI. |
| Auth and account screens | `backend/app/api/endpoints/auth.py`, `frontend/src/pages/LoginPage.tsx`, `SignupPage.tsx` | Change | Keep auth for hosted or future sync, but local desktop MyBox should support local profile/no-login mode. | Local-first auth bypass tests when implemented. |
| Email verification/reset | Auth pages and email service | Defer for local V1 | Useful for hosted future, not needed for local desktop-first MyBox. | Hosted-mode tests only. |
| Admin surface | `backend/app/admin/*` | Defer | Not needed for local MyBox V1 unless hosted multi-user mode returns. | No V1 acceptance dependency. |
| Secrets/env vars | `frontend/src/components/settings/sections/EnvVarsSection.tsx`, `backend/app/models/schemas/settings.py` | Keep with stronger UX | Secrets are necessary, but MyBox should make local trust boundaries and storage obvious. | Settings tests and secret redaction review. |
| Attachments | `backend/app/services/attachment.py`, `frontend/src/components/chat/message-input/AttachButton.tsx` | Keep | Attachments are part of serious coding workflows and context handoff. | Attachment backend tests and UI smoke. |
| Queue/send-now | `backend/app/services/queue.py`, `QueueMessageCard.tsx` | Keep | Important for long-running agents and session control. | Queue behavior tests. |
| Chat search | `frontend/src/components/chat/chat-search/*`, search service | Keep | Search becomes more important as MyBox controls multiple harnesses. | Search tests and UX review. |
| Browser panel | Not a current core surface | Defer | Valuable later, but should not distract from fork foundation and existing terminal/diff/chat strength. | Later browser-panel spike. |
| iOS companion | Not present | Defer | Product direction is valid, but the fork first needs a stable desktop MyBox. | Separate mobile plan. |
| Voice/wake word | Not present | Defer | Requires OS/audio/privacy architecture outside this fork slice. | Separate voice architecture plan. |

## Product-Layer Changes To Plan First

The next implementation goals should be planned in this order:

1. **Local-first desktop access:** remove sign-in as a hard blocker for the local
   desktop app while preserving hosted auth capability for later.
2. **Harness registry:** introduce a data-driven MyBox registry for Codex,
   OpenClaw, Claude Code, OpenCode, and future harnesses.
3. **Native-feeling harness switcher:** adapt Agentrove's existing selector
   language; do not add foreign floating cards or glossy custom surfaces.
4. **OpenClaw read-only adapter design:** define what can be observed safely,
   how it is labeled, and what is explicitly unavailable.
5. **Feature-by-feature UI review:** inspect each Agentrove page and decide
   whether it is MyBox V1, V1 optional, or later.

## Visual Guardrails

Future UI work must preserve Agentrove's native dark app feel. A MyBox addition
should look like it was always part of Agentrove:

- reuse existing spacing, typography, hover states, icons, border radius, and
  panel rhythm,
- add the smallest possible new surface,
- prefer existing primitives under `frontend/src/components/ui/`,
- avoid introducing a separate MyBox dashboard skin,
- reject any design that looks like a pasted-on generic AI dashboard.

## Risk Register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Fork drift from upstream | High | Keep MyBox additions isolated and preserve upstream structures. |
| Auth bypass done unsafely | High | Implement local-first mode deliberately with tests, not by deleting auth. |
| Fake harness truth | High | Use `LIVE`, `LOCAL`, `OBSERVED`, `READ-ONLY`, `MOCK`, `PLANNED`, and `NOT CONNECTED` labels consistently. |
| UI additions looking foreign | High | Compare every visual change against Agentrove baseline screenshots. |
| OpenClaw mutation too early | High | Keep OpenClaw read-only until a separate safety plan exists. |
| Overbuilding before inventory | Medium | Run G0.5 decisions before UI/product implementation. |

## Done Criteria For G0.5

- This audit exists under `docs/mybox/`.
- The completed G0.5 plan exists under `plans/completed/`.
- Generated repo maps include the new audit.
- Verification confirms the docs/script changes are syntactically clean.
- No product UI, backend behavior, OpenClaw, Workflow OS, or active MyBox HTML
  files were changed.
