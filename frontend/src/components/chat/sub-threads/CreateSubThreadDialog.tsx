import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Brain, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { SlashCommandsPanel } from '@/components/chat/message-input/SlashCommandsPanel';
import {
  THINKING_MODES_BY_AGENT,
  coerceThinkingModeForAgent,
  getThinkingModesForAgent,
  type ThinkingModeOption,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import {
  MODES_BY_AGENT,
  coercePermissionModeForAgent,
  getPermissionModeOption,
} from '@/components/chat/permission-mode-selector/permissionModes';
import type { PermissionMode } from '@/store/chatSettingsStore';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useCreateSubThreadMutation } from '@/hooks/queries/useChatQueries';
import { useSlashCommandSuggestions } from '@/hooks/useSlashCommandSuggestions';
import { useChatContext } from '@/hooks/useChatContext';
import { insertToken } from '@/utils/mentionParser';
import { useModelStore } from '@/store/modelStore';
import {
  useChatSettingsStore,
  DEFAULT_PERSONA,
  DEFAULT_PERMISSION_MODE,
} from '@/store/chatSettingsStore';
import { useAuthStore } from '@/store/authStore';
import type { Chat } from '@/types/chat.types';
import type { SlashCommand } from '@/types/ui.types';
import styles from './CreateSubThreadDialog.module.scss';

interface CreateSubThreadDialogProps {
  parentChat: Chat;
  onClose: () => void;
}

export function CreateSubThreadDialog({ parentChat, onClose }: CreateSubThreadDialogProps) {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: models = [] } = useModelsQuery({ enabled: isAuthenticated });
  const { data: settings } = useSettingsQuery({ enabled: isAuthenticated });
  const personas = settings?.personas ?? [];

  const [selectedModelId, setSelectedModelId] = useState('');
  const [personaName, setPersonaName] = useState(DEFAULT_PERSONA);
  const [message, setMessage] = useState('');
  const [thinkingMode, setThinkingMode] = useState<ThinkingModeOption>(
    THINKING_MODES_BY_AGENT['claude'][2],
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(DEFAULT_PERMISSION_MODE);

  const { customSkills, builtinSlashCommands } = useChatContext();

  const selectedModel = models.find((m) => m.model_id === selectedModelId);
  const agentKind = selectedModel?.agent_kind ?? 'claude';
  const permissionModes = MODES_BY_AGENT[agentKind];
  const thinkingModes = getThinkingModesForAgent(agentKind, selectedModelId);
  const effectivePermissionMode = coercePermissionModeForAgent(permissionMode, agentKind);
  const selectedPermissionOption = getPermissionModeOption(permissionMode, agentKind);
  const effectiveThinkingMode = coerceThinkingModeForAgent(
    thinkingMode.value,
    agentKind,
    selectedModelId,
  );
  const selectedThinkingOption =
    thinkingModes.find((mode) => mode.value === effectiveThinkingMode) ?? thinkingModes[0];

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  const handleCursorChange = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPosition(e.currentTarget.selectionStart);
  }, []);

  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand, startPos: number, endPos: number) => {
      const { text, cursor } = insertToken(message, command.value, startPos, endPos);
      setMessage(text);
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(cursor, cursor);
        }
        setCursorPosition(cursor);
      }, 0);
    },
    [message],
  );

  const {
    filteredCommands,
    highlightedIndex,
    hasSuggestions,
    selectCommand,
    handleKeyDown: handleSlashKeyDown,
  } = useSlashCommandSuggestions({
    message,
    cursorPosition,
    onSelect: handleSlashCommandSelect,
    customSkills,
    builtinSlashCommands,
    agentKind,
  });

  // Select first model when models load — ref-based check avoids extra render cycle
  const prevModelsRef = useRef(models);
  if (prevModelsRef.current !== models) {
    prevModelsRef.current = models;
    if (!selectedModelId && models.length > 0) {
      setSelectedModelId(models[0].model_id);
    }
  }

  const createSubThread = useCreateSubThreadMutation(parentChat.id);

  const handleCreate = async () => {
    const trimmedMessage = message.trim();
    if (!selectedModelId?.trim()) {
      toast.error('Please select a model');
      return;
    }
    if (!trimmedMessage) {
      toast.error('Please enter an initial message');
      return;
    }

    try {
      const title = personaName !== DEFAULT_PERSONA ? personaName : trimmedMessage.slice(0, 80);
      const newChat = await createSubThread.mutateAsync({
        title,
        model_id: selectedModelId,
        workspace_id: parentChat.workspace_id,
        parent_chat_id: parentChat.id,
      });

      useModelStore.getState().selectModel(newChat.id, selectedModelId);
      const store = useChatSettingsStore.getState();
      store.setPersona(newChat.id, personaName);
      store.setPermissionMode(newChat.id, effectivePermissionMode);
      store.setThinkingMode(newChat.id, effectiveThinkingMode);

      onClose();
      navigate(`/chat/${newChat.id}`, { state: { initialPrompt: trimmedMessage } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create sub-thread');
    }
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      size="sm"
      zIndex="modalHighest"
      className={styles.dialog}
    >
      <div className={styles['create-sub-thread-dialog']}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <GitBranch className={styles['header-icon']} />
          </div>
          <h2 className={styles.title}>New sub-thread</h2>
        </div>

        <p className={styles['parent-info']}>
          From: <span className={styles['parent-title']}>{parentChat.title}</span>
        </p>

        <div className={styles.fields}>
          <div>
            <label className={styles['field-label']}>Model</label>
            <ModelSelector
              selectedModelId={selectedModelId}
              onModelChange={setSelectedModelId}
              dropdownPosition="bottom"
              compact={false}
            />
          </div>

          <div>
            <label className={styles['field-label']}>Persona</label>
            <Select
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              className={styles['persona-select']}
            >
              <option value={DEFAULT_PERSONA}>Default</option>
              {personas.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className={styles['mode-row']}>
            {selectedThinkingOption && (
              <Dropdown
                value={selectedThinkingOption}
                items={thinkingModes}
                getItemKey={(m) => m.value ?? 'off'}
                getItemLabel={(m) => m.label}
                onSelect={setThinkingMode}
                leftIcon={Brain}
                dropdownPosition="bottom"
              />
            )}
            <Dropdown
              value={selectedPermissionOption}
              items={permissionModes}
              getItemKey={(m) => m.value}
              getItemLabel={(m) => m.label}
              onSelect={(m) => setPermissionMode(m.value)}
              leftIcon={Shield}
              dropdownPosition="bottom"
            />
          </div>

          <div>
            <label className={styles['field-label']}>Initial message</label>
            <div className={styles['message-input-wrap']}>
              {hasSuggestions && (
                <SlashCommandsPanel
                  suggestions={filteredCommands}
                  highlightedIndex={highlightedIndex}
                  onSelect={selectCommand}
                />
              )}
              <Textarea
                ref={textareaRef}
                variant="unstyled"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setCursorPosition(e.target.selectionStart);
                }}
                onKeyDown={handleSlashKeyDown}
                onKeyUp={handleCursorChange}
                onClick={handleCursorChange}
                onSelect={handleCursorChange}
                placeholder="Message Agentrove... (/ for commands)"
                rows={3}
                className={styles['message-textarea']}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={createSubThread.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={createSubThread.isPending}
        >
          {createSubThread.isPending ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </BaseModal>
  );
}
