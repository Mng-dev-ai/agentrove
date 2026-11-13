from typing import TYPE_CHECKING

from app.models.types import AgentKind
from app.services.acp.adapters import PERSONAS_SUPPORTED_AGENTS

if TYPE_CHECKING:
    from app.models.db_models.user import UserSettings

PROMPT_SUGGESTIONS_INSTRUCTIONS = """
<prompt_suggestions_instructions>
At the end of EVERY response, you MUST provide 2-3 contextually relevant follow-up prompt suggestions.
These suggestions should help the user continue the conversation productively.

Format your suggestions as follows, placing them at the VERY END of your response:
<prompt_suggestions>
["First suggestion", "Second suggestion", "Third suggestion"]
</prompt_suggestions>

Guidelines for suggestions:
- Make them concise and actionable (under 50 characters each)
- Relate them directly to what was just discussed
- Offer different directions the user might want to explore
- For coding tasks: suggest next steps like testing, optimization, or related features
- For questions: suggest follow-up questions or related topics
</prompt_suggestions_instructions>
"""


CHAT_MENTIONS_INSTRUCTIONS = """
<chat_mentions_instructions>
User messages may contain @chat:<chat_id> tokens referencing other AgentRove chats.
The referenced chat's content is NOT included in the prompt. To read it, call the
agentrove MCP get_messages tool with that chat_id: the first call returns the most
recent messages, and passing next_cursor pages back through older ones (repeat while
has_more is true to read the full history).
</chat_mentions_instructions>
"""


FILE_ATTACHMENT_INSTRUCTIONS = """
<file_attachment_instructions>
The user cannot see files you create on disk (e.g. screenshots in /tmp). To show the
user a screenshot or other output image, PDF, or XLSX file, call the agentrove MCP
attach_file tool with its path; it is shown in the chat with your response.
</file_attachment_instructions>
"""


INBOX_INSTRUCTIONS = """
<inbox_instructions>
The user may not be watching this chat. The inbox is for things the user doesn't know
they need to know: call the agentrove MCP notify_user tool only when you discover
something unexpected that they would want to hear about before your turn ends — a bug
or security issue (even outside the task), a blocker that needs their input, a finding
that changes the plan, or a consequential decision you made on their behalf. Never use
it to report progress or expected outcomes of the task: pushing, opening a PR, CI
passing, a deploy finishing, or being done. The final reply already notifies the user.
</inbox_instructions>
"""


MEMORY_INSTRUCTIONS = """
<memory_instructions>
AgentRove keeps a memory shared across every agent and chat. A <memory> block in the
first message holds the user's pinned memories; everything else is reachable only through
the agentrove MCP search_memory tool, so search before decisions that depend on the user's
preferences or the repo's conventions. When memory has nothing on something discussed in
earlier chats, search_chats finds it in past transcripts. Save with remember only durable facts
(preferences, corrections, conventions, environment facts), never task progress or
anything derivable from the code. Search first and update the existing memory (pass
memory_id) instead of adding a duplicate. Use scope "workspace" for repo-specific facts
and "global" for user-wide ones. Save to AgentRove memory rather than your CLI's own
memory files, and forget memories that turn out to be wrong.
</memory_instructions>
"""


DEFAULT_PERSONA_NAME = "Default"


def build_system_prompt_for_chat(
    user_settings: "UserSettings",
    agent_kind: AgentKind,
    selected_persona_name: str = DEFAULT_PERSONA_NAME,
    *,
    channel_member: bool = False,
    agentrove_mcp: bool = True,
    sub_thread: bool = False,
) -> str:
    persona_content = ""
    # Persona only for adapters that can replace the base prompt over ACP.
    if (
        agent_kind in PERSONAS_SUPPORTED_AGENTS
        and selected_persona_name != DEFAULT_PERSONA_NAME
        and user_settings.personas
    ):
        persona = next(
            (
                p
                for p in user_settings.personas
                if p.get("name") == selected_persona_name
            ),
            None,
        )
        if persona:
            persona_content = f"\n{persona['content']}\n"

    if channel_member:
        return (
            f"{persona_content}\n{MEMORY_INSTRUCTIONS}"
            if agentrove_mcp
            else persona_content
        )

    if sub_thread:
        return f"{persona_content}\n{CHAT_MENTIONS_INSTRUCTIONS}\n{FILE_ATTACHMENT_INSTRUCTIONS}\n{MEMORY_INSTRUCTIONS}"

    return f"{persona_content}\n{CHAT_MENTIONS_INSTRUCTIONS}\n{FILE_ATTACHMENT_INSTRUCTIONS}\n{INBOX_INSTRUCTIONS}\n{MEMORY_INSTRUCTIONS}\n{PROMPT_SUGGESTIONS_INSTRUCTIONS}"
