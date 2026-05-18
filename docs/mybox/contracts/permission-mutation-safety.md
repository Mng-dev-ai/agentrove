# Permission and Mutation Safety Contract

**Status:** G1 contract
**Date:** 2026-05-18

MyBox controls powerful local development surfaces. The app must make it clear
when it is observing state versus mutating state.

## State Classes

| Class | Meaning |
| --- | --- |
| Observation | MyBox reads or displays state without changing the outside world. |
| User-approved mutation | A user explicitly approves an action that changes files, git, terminal state, secrets, external services, or harness state. |
| Adapter-initiated mutation | A harness requests or performs a mutation through its own protocol or process. |
| Read-only adapter | Adapter is allowed to observe but must not mutate through MyBox. |

## Protected Mutation Surfaces

The following surfaces require explicit handling:

- filesystem writes,
- file deletes/moves,
- git branch/commit/push/pull/restore,
- terminal command execution,
- secret/env var writes,
- permission approval/rejection,
- external network operations that create remote state,
- harness session start/send/cancel where the harness can mutate downstream.

## OpenClaw V1 Boundary

OpenClaw V1 in MyBox is read-only. It may eventually expose discovery, status,
session listing, or passive observation if verified, but it must not expose:

- send message,
- approve permission,
- start mutating run,
- run terminal command,
- write file,
- commit/push/pull,
- mutate OpenClaw run state,
- mutate Workflow OS or shared-brain state.

## UI Rules

- Read-only surfaces must not render active mutation controls.
- Permission requests must show source, target, action, and decision state.
- Terminal/diff/git/file actions must show provenance when multiple harnesses
  can touch the same workspace.
- Raw event panels must not become hidden approval surfaces.

## Test Expectations

Future implementation must include negative tests proving:

- read-only adapters cannot call mutating methods,
- OpenClaw V1 cannot send/approve/write/run,
- permission approval requires explicit user action,
- terminal/diff/git surfaces do not confuse observed output with executable
  control.
