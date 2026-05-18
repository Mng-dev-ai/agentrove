# Truth Label Contract

**Status:** G1 contract
**Date:** 2026-05-18

MyBox must label the source and reliability of user-facing harness and run state.
The user should never have to guess whether a value is live, local, observed, or
representative.

## Labels

| Label | Meaning |
| --- | --- |
| `LIVE` | Produced by an active connected session or adapter stream. |
| `LOCAL` | Produced by local MyBox state, local config, or local process inspection. |
| `OBSERVED` | Read from logs, artifacts, stored events, or passive observation. |
| `READ-ONLY` | Inspectable through MyBox but not mutable through MyBox. |
| `MOCK` | Representative fixture/demo data. |
| `PLANNED` | Product design or future capability, not implemented. |
| `NOT CONNECTED` | Adapter exists in registry but is unavailable or unconfigured. |

## Hard Rules

- `MOCK` and `PLANNED` data must never be displayed as `LIVE`.
- `OBSERVED` data must not imply user control.
- `READ-ONLY` surfaces must not expose approve, send, write, commit, push, or
  terminal-run actions.
- A value can have more than one visible label when helpful, such as
  `OBSERVED` plus `READ-ONLY`.
- Missing or degraded data must be shown honestly instead of replaced with
  invented values.

## Implementation Expectations

Truth labels should be represented as explicit typed values in the future
harness registry and event model. UI components should receive labels from data
models, not infer them from display names.

Tests should include:

- fixture data renders as `MOCK`,
- unavailable adapters render as `NOT CONNECTED`,
- OpenClaw read-only observations render with `READ-ONLY`,
- no fixture or story can display `LIVE` unless it represents a live source.
