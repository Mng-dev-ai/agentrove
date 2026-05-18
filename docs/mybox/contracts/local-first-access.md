# Local-First Access Contract

**Status:** G1 contract
**Date:** 2026-05-18

MyBox is desktop-first. A local desktop user should be able to enter the app and
work with local harnesses without being blocked by hosted-style account sign-in.

## Required Behavior

- Desktop local mode should not require hosted login.
- Hosted/web mode must not be weakened by local desktop access.
- Auth relaxation must be owned by backend/runtime mode or another explicit
  trusted boundary. It must not be a frontend-only bypass.
- Existing auth code should be changed deliberately, not deleted.
- Local profile/session behavior must still protect workspace ownership and
  mutation surfaces.

## Non-Goals

- Do not remove hosted auth.
- Do not remove refresh token tests.
- Do not make all API routes unauthenticated.
- Do not silently convert hosted mode into local mode.

## Future Implementation Shape

The preferred future shape is an explicit runtime mode:

| Mode | Expected behavior |
| --- | --- |
| desktop-local | Local profile is available without hosted sign-in; local storage and workspace ownership remain scoped. |
| hosted-web | Existing hosted auth remains required. |
| test | Tests can create users and sessions deterministically. |

The exact implementation must be decided in the G2 local-first access plan after
reading current auth, dependency, and desktop startup code.

## Test Expectations

G2 must include:

- desktop local mode enters the app without hosted sign-in,
- hosted/web mode still requires auth,
- backend routes do not trust a frontend-only flag,
- workspace access boundaries remain enforced,
- login/signup routes remain functional where hosted mode is enabled.
