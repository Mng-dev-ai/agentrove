from typing import TYPE_CHECKING

from app.services.acp.adapters import AgentKind, PERSONAS_SUPPORTED_AGENTS

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


DEFAULT_PERSONA_NAME = "Default"


def build_system_prompt_for_chat(
    user_settings: "UserSettings",
    agent_kind: AgentKind,
    selected_persona_name: str = DEFAULT_PERSONA_NAME,
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

    return f"{persona_content}\n{CHAT_MENTIONS_INSTRUCTIONS}\n{PROMPT_SUGGESTIONS_INSTRUCTIONS}"
