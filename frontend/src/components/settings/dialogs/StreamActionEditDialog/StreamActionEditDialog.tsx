import { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch, Brain, Shield } from 'lucide-react';
import type { CustomSkill, Persona, StreamAction } from '@/types/user.types';
import type { SlashCommand } from '@/types/ui.types';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Select } from '@/components/ui/primitives/Select/Select';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError/DialogError';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { SlashCommandsPanel } from '@/components/chat/message-input/SlashCommandsPanel';
import {
  getThinkingModesForAgent,
  getThinkingModeOption,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import {
  MODES_BY_AGENT,
  getPermissionModeOption,
} from '@/components/chat/permission-mode-selector/permissionModes';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useWorkspacesList, useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useSlashCommandSuggestions } from '@/hooks/useSlashCommandSuggestions';
import { insertToken } from '@/utils/mentionParser';
import { EMPTY_BUILTIN_COMMANDS } from '@/config/constants';
import { DEFAULT_PERSONA } from '@/store/chatSettingsStore';
import styles from './StreamActionEditDialog.module.scss';

const EMPTY_SKILLS: CustomSkill[] = [];

interface StreamActionEditDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  action: StreamAction;
  personas: Persona[];
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onActionChange: <K extends keyof StreamAction>(field: K, value: StreamAction[K]) => void;
}

export const StreamActionEditDialog: React.FC<StreamActionEditDialogProps> = ({
  isOpen,
  isEditing,
  action,
  personas,
  error,
  onClose,
  onSubmit,
  onActionChange,
}) => {
  const { data: models = [] } = useModelsQuery();
  // Builtin slash commands are static per agent, so any workspace's resources
  // surface the same set. Custom skills are intentionally excluded — stream actions
  // are global and run in the clicked chat's workspace, where a skill suggested here
  // may not exist; builtins are valid everywhere.
  const workspaces = useWorkspacesList();
  const { data: resources } = useWorkspaceResourcesQuery(workspaces[0]?.id);
  const builtinSlashCommands = resources?.builtin_slash_commands ?? EMPTY_BUILTIN_COMMANDS;

  // Form-state init: seed new actions and actions whose saved model left the
  // registry — ModelSelector no longer commits one, and save requires a model_id.
  // Effect, not render-phase seeding: onActionChange writes parent-owned state.
  useEffect(() => {
    if (models.length > 0 && !models.some((m) => m.model_id === action.model_id)) {
      onActionChange('model_id', models[0].model_id);
    }
  }, [models, action.model_id, onActionChange]);

  const selectedModel = models.find((m) => m.model_id === action.model_id);
  const agentKind = selectedModel?.agent_kind ?? 'claude';

  const permissionModes = MODES_BY_AGENT[agentKind];
  const selectedPermissionOption = getPermissionModeOption(action.permission_mode, agentKind);
  const thinkingModes = getThinkingModesForAgent(agentKind, action.model_id);
  const selectedThinkingOption = getThinkingModeOption(
    action.thinking_mode,
    agentKind,
    action.model_id,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  const handleCursorChange = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPosition(e.currentTarget.selectionStart);
  }, []);

  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand, startPos: number, endPos: number) => {
      const { text, cursor } = insertToken(action.command, command.value, startPos, endPos);
      onActionChange('command', text);
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(cursor, cursor);
        }
        setCursorPosition(cursor);
      }, 0);
    },
    [action.command, onActionChange],
  );

  const {
    filteredCommands,
    highlightedIndex,
    hasSuggestions,
    selectCommand,
    handleKeyDown: handleSlashKeyDown,
  } = useSlashCommandSuggestions({
    message: action.command,
    cursorPosition,
    onSelect: handleSlashCommandSelect,
    customSkills: EMPTY_SKILLS,
    builtinSlashCommands,
    agentKind,
  });

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" className={styles.dialog}>
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <GitBranch className={styles['header-icon']} />
          </div>
          <h3 className={styles.title}>{isEditing ? 'Edit action' : 'Add action'}</h3>
        </div>

        <DialogError error={error} className={styles.error} />

        <div className={styles.fields}>
          <div>
            <Label className={styles.label}>Button label</Label>
            <Input
              value={action.label}
              onChange={(e) => onActionChange('label', e.target.value)}
              placeholder="Review"
              className={styles.input}
            />
          </div>

          <div>
            <Label className={styles.label}>Model</Label>
            <ModelSelector
              selectedModelId={action.model_id}
              onModelChange={(modelId) => onActionChange('model_id', modelId)}
              dropdownPosition="bottom"
              compact={false}
            />
          </div>

          <div>
            <Label className={styles.label}>Persona</Label>
            <Select
              value={action.persona_name}
              onChange={(e) => onActionChange('persona_name', e.target.value)}
              className={styles.select}
            >
              <option value={DEFAULT_PERSONA}>Default</option>
              {personas.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className={styles['control-row']}>
            {selectedThinkingOption && (
              <Dropdown
                value={selectedThinkingOption}
                items={thinkingModes}
                getItemKey={(m) => m.value}
                getItemLabel={(m) => m.label}
                onSelect={(m) => onActionChange('thinking_mode', m.value)}
                leftIcon={Brain}
                dropdownPosition="bottom"
              />
            )}
            <Dropdown
              value={selectedPermissionOption}
              items={permissionModes}
              getItemKey={(m) => m.value}
              getItemLabel={(m) => m.label}
              onSelect={(m) => onActionChange('permission_mode', m.value)}
              leftIcon={Shield}
              dropdownPosition="bottom"
            />
          </div>

          <div>
            <Label className={styles.label}>Command</Label>
            <div className={styles['command-wrap']}>
              {hasSuggestions && (
                <SlashCommandsPanel
                  suggestions={filteredCommands}
                  highlightedIndex={highlightedIndex}
                  onSelect={selectCommand}
                />
              )}
              <Textarea
                ref={textareaRef}
                value={action.command}
                onChange={(e) => {
                  onActionChange('command', e.target.value);
                  setCursorPosition(e.target.selectionStart);
                }}
                onKeyDown={handleSlashKeyDown}
                onKeyUp={handleCursorChange}
                onClick={handleCursorChange}
                onSelect={handleCursorChange}
                placeholder="/quality-review"
                className={styles['command-textarea']}
                rows={5}
              />
            </div>
            <p className={styles.hint}>
              A slash command, skill, or prompt — sent verbatim to the sub-thread.
            </p>
          </div>
        </div>

        <DialogFooter
          onCancel={onClose}
          onSave={onSubmit}
          saveLabel={isEditing ? 'Update' : 'Add action'}
          disabled={!action.label.trim() || !action.model_id.trim() || !action.command.trim()}
        />
      </div>
    </BaseModal>
  );
};
