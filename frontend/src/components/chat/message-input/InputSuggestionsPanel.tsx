import { memo } from 'react';
import { SlashCommandsPanel } from './SlashCommandsPanel';
import { MentionSuggestionsPanel } from './MentionSuggestionsPanel';
import { useInputState, useInputActions } from '@/hooks/useInputContext';

export const InputSuggestionsPanel = memo(function InputSuggestionsPanel() {
  const state = useInputState();
  const actions = useInputActions();

  if (state.isMentionActive) {
    return (
      <MentionSuggestionsPanel
        files={state.filteredFiles}
        chats={state.filteredChats}
        highlightedIndex={state.highlightedMentionIndex}
        onSelect={actions.selectMention}
      />
    );
  }

  return (
    <SlashCommandsPanel
      suggestions={state.slashCommandSuggestions}
      highlightedIndex={state.highlightedSlashCommandIndex}
      onSelect={actions.selectSlashCommand}
    />
  );
});
