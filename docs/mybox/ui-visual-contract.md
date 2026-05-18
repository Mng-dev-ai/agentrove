# MyBox UI Visual Contract

MyBox should feel like a polished native agent-control app built from Agentrove,
not a generic dashboard and not a pasted-on clone of another product.

## Baseline

Use Agentrove's current UI as the baseline:

- dark native desktop feel,
- calm density,
- restrained borders and surfaces,
- sidebar plus central timeline,
- right-side review/inspector surfaces,
- compact tool, diff, terminal, and permission affordances.

Codex/OpenAI references are useful for interaction patterns, not for copying a
skin directly.

## Hard Rules

- Do not redesign from zero unless the user explicitly asks for a full redesign.
- Do not add marketing-page patterns, hero sections, decorative gradients, or
  oversized cards.
- Do not add UI elements that look visually foreign to Agentrove.
- Do not show fake live data. Use visible truth labels for mock, planned,
  read-only, local, observed, disconnected, or not connected states.
- Do not hardcode a fixed harness list inside presentation components. Use a
  registry/config layer.
- Do not clutter the main conversation with every raw event. Prefer collapsed
  summaries with detailed inspection available on demand.

## Desired Direction

MyBox-specific UI should improve:

- harness switching,
- visible tool-call and sub-agent activity,
- permission review,
- diff/review workflows,
- terminal and browser surfaces,
- adapter capability visibility,
- local/remote truth labels,
- mobile companion readability.

## Acceptance For UI Changes

A UI change is not complete until:

1. It is visually inspected in the browser or desktop shell.
2. It is checked against the baseline Agentrove style.
3. It avoids invented live status.
4. It remains usable at one narrow viewport when practical.
5. Screenshots or clear browser evidence are recorded for non-trivial changes.

If a generated or agent-built design looks generic, reject it and return to the
baseline style.
