# MyBox V1 Product Blueprint

This blueprint is the product authority for the MyBox fork of Agentrove. It
defines the intended V1 product shape before implementation work adds harness
registries, adapters, UI controls, or deeper desktop packaging.

## Product Identity

MyBox is the user-facing product. Agentrove remains the upstream base engine and
may appear in about, credits, diagnostics, developer documentation, and upstream
sync notes, but normal product surfaces should say MyBox.

MyBox is a macOS-desktop-first control surface for supervising AI coding and
automation harnesses. Web mode remains useful for development, fallback, and
remote inspection, but V1 product decisions should optimize the native desktop
experience first.

Future iPhone or mobile support is an architecture constraint, not a V1 feature
target. V1 should avoid desktop decisions that block a later companion app, but
it should not build iPhone-specific surfaces yet.

## Harness Model

First-class V1 harness targets:

- Codex
- OpenClaw
- Claude Code
- OpenCode

Existing Agentrove-supported providers such as Copilot and Cursor remain
available as secondary adapters. They should not dominate the MyBox V1
navigation, but they should not be deleted or hidden without a feature review
decision.

Harnesses must be data-driven. Presentation components must consume a registry
or adapter contract and must not define their own fixed arrays of harness names.

Truth labels are mandatory. Any value that is not live adapter data must be
visibly labeled as `LOCAL`, `OBSERVED`, `READ-ONLY`, `MOCK`, `PLANNED`, or
`NOT CONNECTED`, as appropriate. A cleaner UI is not a reason to hide source
truth.

## Product Vocabulary

Use these user-facing terms:

- `Workspace`: a real local folder or repository.
- `Chat`: the conversation a user opens, resumes, or sends messages to.
- `Harness`: an external or embedded coding/automation runtime such as Codex,
  OpenClaw, Claude Code, or OpenCode.

Technical terms such as `session`, `run`, `adapter`, `stream`, and `event`
belong in inspector, diagnostics, logs, or developer-facing copy unless the
screen is explicitly technical.

OpenClaw may have projectless chats. MyBox should not invent local workspace
metadata for them. Projectless OpenClaw chats live under a truthful virtual
workspace or bucket until a real mapping exists.

## Information Architecture

The primary app structure is workspace-first:

- The left sidebar groups chats under workspaces.
- The app opens to the last active workspace and harness context.
- A global harness filter or switcher controls visible chats and the default
  composer harness.
- Each chat still shows its own harness identity where needed.
- Primary navigation focuses on Chats, Workspaces, and Harnesses.

OpenClaw parent chats may spawn or observe work performed by other harnesses.
Child harness work should appear inline inside the parent OpenClaw chat as
collapsed, openable child-session rows. Long child work can open into a detail
view, but it should not clutter the sidebar by default.

## Main Interaction Model

The center of the app remains chat and timeline first:

- User messages align visually as user-authored messages.
- Harness responses align as assistant-authored messages.
- Work activity appears in the timeline only at a useful level of detail.
- Raw event streams belong in inspector/details, not as the default chat view.

Before changing the active-turn stream UI, evaluate Agentrove's native stream
behavior using real or fixture activity. Only adjust the parts that fail the
MyBox target. Codex is a useful interaction reference, especially for collapsed
work summaries, but the app must still feel native to Agentrove/MyBox.

When a turn finishes, the default view should show the final answer plus a
compact work summary row. The summary should expand to reveal tools, file
events, sub-agent or child-session activity, permissions, diffs, errors, and
other observable details when those details exist.

Private chain-of-thought must not be exposed. Observable planning summaries,
tool events, file operations, permissions, and harness stream events may be
shown when they are actually available.

## Panels and Tools

The right panel has three first-class modes:

- `Review`: diffs, changed files, review state, and source-control context.
- `Inspector`: selected chat, event, tool call, permission, child session,
  adapter capability, raw payload, or telemetry details.
- `Browser`: optional embedded local preview when a page is available.

The browser is not a permanent dashboard panel. It is an optional preview
surface that can appear when it helps inspect a local app, artifact, or preview
target.

The terminal should live as a bottom drawer. It is important enough to be a V1
surface, but it should not permanently displace the chat timeline or right
inspector.

## Adapter Direction

Codex is the first ambitious live-adapter target. V1 should investigate native
Codex app, CLI, server, and history surfaces first, then choose the least
fragile path for:

- reading existing and new Codex chats where available,
- sending messages,
- streaming responses,
- showing observable work summaries,
- showing tool activity,
- showing diffs and review context where available.

OpenClaw starts read-only. V1 may show OpenClaw chats, runs, workflow state,
child harness work, and artifacts only when those values are truthfully
available. MyBox must not send OpenClaw prompts, approve OpenClaw actions, spawn
OpenClaw work, mutate OpenClaw run state, edit Workflow OS, or modify
shared-brain through the OpenClaw adapter without a later safety-scoped plan.

Claude Code and OpenCode should be adapter-ready in V1. They may appear in the
harness registry, settings, and setup/status surfaces with truthful capability
and connection labels. Live control can follow after the Codex/OpenClaw adapter
architecture has proven itself.

MyBox should present one consistent approval interface for dangerous actions
while preserving harness-native permission details underneath. A MyBox approval
must never imply that a read-only adapter can mutate state.

## Visual Direction

Agentrove's current interface is the visual baseline. MyBox additions should
look like Agentrove gained a capability, not like another application was
inserted into it.

Allowed direction:

- refined native desktop density,
- existing Agentrove dark surfaces, spacing, typography, and controls,
- Codex-like interaction patterns where they fit the existing style,
- compact status and capability labels,
- contextual detail in the right panel or bottom drawer.

Avoid:

- full redesigns without explicit approval,
- marketing-page layouts,
- decorative gradients,
- oversized cards,
- bright provider-themed panels,
- fixed hardcoded harness UI,
- fake live data,
- raw event clutter in the main chat.

## Settings and Configuration

MyBox should have one Harnesses settings area. It should list all harnesses with
their connection state, capabilities, auth or setup status, known limitations,
and supported actions.

Unavailable harnesses should say `NOT CONNECTED` or `PLANNED`. Representative
or fixture data should say `MOCK`. Log-derived or artifact-derived data should
say `OBSERVED`. Read-only integrations should say `READ-ONLY`.

## Feature Review Policy

Existing Agentrove features are preserved until reviewed. Do not remove, hide,
or redesign a feature just because it is not in the first MyBox sketch.

Before changing a visible screen or major feature, update the inventory decision
for that surface as one of:

- `keep`: preserve existing behavior and build around it.
- `change`: adapt it for MyBox while preserving the useful core.
- `defer`: leave untouched for V1.
- `remove`: remove only with an explicit rationale and tests.

The detailed keep/change/defer/remove pass happens after this blueprint and
before broad screen-by-screen implementation.

## Blueprint Compliance Checklist

Future plans that touch product behavior, UI, harnesses, permissions, branding,
or adapter boundaries must answer:

1. Which blueprint sections apply?
2. Does this affect brand, information architecture, harness behavior,
   permissions, visual language, or truth labels?
3. Does the change preserve Agentrove's native visual language?
4. Does the change avoid fake live data?
5. Does the change avoid hardcoded harness lists in presentation components?
6. Are `MOCK`, `PLANNED`, `READ-ONLY`, `OBSERVED`, `LOCAL`, and
   `NOT CONNECTED` labels visible where relevant?
7. Does the change avoid mutating OpenClaw or Workflow OS unless an explicit
   safety-scoped plan grants that scope?
8. If the change touches an existing screen, has the feature inventory decision
   been updated first?

If a plan cannot answer these questions cleanly, it is not ready for product
implementation.
