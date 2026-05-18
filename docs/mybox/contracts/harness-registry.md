# Harness Registry Contract

**Status:** G1 contract
**Date:** 2026-05-18

MyBox must treat harnesses as registry data, not as hardcoded presentation
choices. The first-class targets are Codex, OpenClaw, Claude Code, and OpenCode,
but the UI must support future harnesses without component rewrites.

## Required Harness Fields

Every harness definition must include:

| Field | Meaning |
| --- | --- |
| `id` | Stable lowercase identifier used by code and tests. |
| `displayName` | User-facing name. |
| `adapterKind` | Integration shape: `acp`, `cli`, `api`, `log-observer`, or `planned`. |
| `status` | Truth label from the truth-label contract. |
| `capabilities` | List of declared capabilities. |
| `supportsMutation` | Whether the harness can mutate through MyBox. |
| `supportsReadOnly` | Whether MyBox can observe it without mutation. |
| `authRequirement` | `none`, `local_cli`, `api_key`, `hosted_login`, or `unknown`. |
| `sessionScope` | `workspace`, `global`, `external`, or `unknown`. |
| `eventSources` | Sources such as `acp`, `pty`, `websocket`, `http`, `filesystem`, or `manual_fixture`. |
| `permissionModel` | `agentrove`, `external`, `none`, or `unknown`. |

## Capability Vocabulary

Initial capability values:

- `chat`
- `streaming`
- `thinking_summary`
- `tool_cards`
- `permission_prompts`
- `terminal_observation`
- `terminal_mutation`
- `diff_observation`
- `git_mutation`
- `file_observation`
- `file_mutation`
- `session_list`
- `session_resume`
- `read_only_observation`
- `subagent_observation`

## Presentation Rule

Presentation components must consume a registry or registry-derived selector
model. They must not define their own arrays of harness names such as Codex,
OpenClaw, Claude Code, or OpenCode.

Provider-specific icons and tool renderers may remain provider-specific, but the
choice of which harnesses appear in MyBox must come from registry data.

## OpenClaw Rule

OpenClaw begins as one of:

- `PLANNED`
- `NOT CONNECTED`
- `READ-ONLY`
- `OBSERVED`

OpenClaw must not expose mutating methods until a later safety-scoped plan
explicitly changes this contract.

## Test Expectations

Future implementation must include:

- registry schema validation,
- rendering tests with multiple fixture harnesses,
- a no-hardcoded-harness-list check,
- OpenClaw negative tests proving mutating methods are absent or disabled.
