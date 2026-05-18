# Adapter Boundaries

| File | Exports |
| --- | --- |
| backend/app/services/acp/__init__.py | adapter module |
| backend/app/services/acp/adapters.py | AgentKind, coerce_thinking_mode, build_system_prompt_meta, PermissionConfig, LaunchConfig, SessionConfig, AgentAdapter, ClaudeAgentAdapter, CodexAgentAdapter, CopilotCliAdapter, CursorAgentAdapter, OpencodeAgentAdapter |
| backend/app/services/acp/client.py | AcpClientHandler |
| backend/app/services/acp/session.py | AcpSessionConfig, AcpSession |

Known first-class Agentrove provider names appear in `backend/app/services/acp/adapters.py` and frontend provider-specific tool/icon modules. MyBox harness entries must later be registry-driven rather than presentation-component hardcoded.
