# MyBox Adapter Architecture

MyBox supervises multiple AI coding and automation harnesses through a shared
workspace interface.

First-class harness targets:

- Codex
- OpenClaw
- Claude Code
- OpenCode

The list must remain data-driven so additional harnesses can be added later.

## Adapter Shape

Each harness adapter should declare:

- stable id,
- display name,
- connection state,
- supported capabilities,
- authentication/config state,
- session/thread inventory support,
- streaming support,
- tool-call visibility,
- diff/review support,
- terminal support,
- permission support,
- sub-agent visibility,
- known limitations.

UI components consume adapter capabilities. They should not infer behavior from
the harness name.

## Truth Labels

Use explicit labels for user-facing values:

- `live`: sourced from an active adapter session.
- `local`: sourced from local state in this app.
- `observed`: read from logs, events, or artifacts.
- `read-only`: inspectable but not mutable.
- `mock`: representative data only.
- `planned`: product design, not implemented.
- `not connected`: adapter exists but is unavailable.

Never present `mock` or `planned` values as live.

## OpenClaw Boundary

OpenClaw integration starts read-only. Do not mutate OpenClaw, Workflow OS,
shared-brain, or run state from this fork without explicit task scope and a
separate safety plan.

Initial OpenClaw adapter work should read:

- gateway/session status if exposed through a supported API,
- run artifacts only when safely scoped,
- workflow level/add-on metadata only when truthfully available.

## ACP Boundary

Agentrove already uses ACP for agent providers. Prefer existing ACP/provider
patterns before adding new transport code. Do not put user-facing data in ACP
metadata fields that agents are not required to read.
