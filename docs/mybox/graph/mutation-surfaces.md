# Mutation Surfaces

| File | Detected mutation candidates |
| --- | --- |
| backend/app/admin/config.py | secrets, external_network |
| backend/app/admin/views.py | git, filesystem, external_network |
| backend/app/api/endpoints/attachments.py | filesystem, external_network |
| backend/app/api/endpoints/auth.py | git, filesystem, secrets, permissions, external_network |
| backend/app/api/endpoints/chat.py | git, terminal, filesystem, permissions, external_network |
| backend/app/api/endpoints/github.py | git, external_network |
| backend/app/api/endpoints/sandbox.py | git, terminal, filesystem, secrets, external_network |
| backend/app/api/endpoints/skills.py | filesystem, external_network |
| backend/app/api/endpoints/websocket.py | terminal, filesystem, external_network |
| backend/app/api/endpoints/workspace.py | filesystem, external_network |
| backend/app/constants.py | git, terminal, filesystem, permissions, external_network |
| backend/app/core/config.py | git, filesystem, secrets, permissions, external_network |
| backend/app/core/deps.py | git, filesystem, secrets, permissions, external_network |
| backend/app/core/middleware.py | filesystem, secrets, permissions, external_network |
| backend/app/core/security.py | terminal, filesystem, secrets, permissions, external_network |
| backend/app/core/user_manager.py | git, secrets, external_network |
| backend/app/db/session.py | git |
| backend/app/db/sqlite.py | filesystem |
| backend/app/db/types.py | secrets |
| backend/app/main.py | git, terminal, filesystem, external_network |
| backend/app/models/db_models/chat.py | git, filesystem |
| backend/app/models/db_models/refresh_token.py | filesystem |
| backend/app/models/db_models/user.py | git, filesystem, secrets, external_network |
| backend/app/models/db_models/workspace.py | filesystem |
| backend/app/models/schemas/chat.py | filesystem, permissions |
| backend/app/models/schemas/github.py | git, external_network |
| backend/app/models/schemas/queue.py | permissions |
| backend/app/models/schemas/sandbox.py | git, terminal, filesystem, secrets |
| backend/app/models/schemas/secrets.py | secrets |
| backend/app/models/schemas/settings.py | git, secrets, external_network |
| backend/app/models/schemas/skills.py | filesystem |
| backend/app/models/schemas/workspace.py | git, terminal, filesystem |
| backend/app/models/types.py | filesystem, permissions |
| backend/app/prompts/enhance_prompt.py | git, filesystem, external_network |
| backend/app/prompts/generate_commit_message.py | git, filesystem |
| backend/app/prompts/generate_pr_description.py | git, filesystem, external_network |
| backend/app/prompts/generate_title.py | filesystem |
| backend/app/prompts/system_prompt.py | git |
| backend/app/services/acp/adapters.py | git, filesystem, permissions, external_network |
| backend/app/services/acp/client.py | git, terminal, filesystem, permissions |
| backend/app/services/acp/session.py | git, terminal, filesystem, permissions, external_network |
| backend/app/services/agent.py | git, terminal, filesystem, secrets, permissions, external_network |
| backend/app/services/attachment.py | filesystem |
| backend/app/services/chat.py | git, terminal, filesystem, permissions |
| backend/app/services/email.py | git, filesystem, external_network |
| backend/app/services/exceptions.py | git, filesystem, external_network |
| backend/app/services/git.py | git, terminal, filesystem, secrets, permissions, external_network |
| backend/app/services/github.py | git, external_network |
| backend/app/services/message.py | git, terminal, filesystem |
| backend/app/services/queue.py | filesystem, permissions |
| backend/app/services/refresh_token.py | git, filesystem |
| backend/app/services/sandbox.py | git, terminal, filesystem, secrets, external_network |
| backend/app/services/sandbox_providers/__init__.py | terminal, filesystem |
| backend/app/services/sandbox_providers/base.py | git, terminal, filesystem |
| backend/app/services/sandbox_providers/docker_provider.py | git, terminal, filesystem, permissions, external_network |
| backend/app/services/sandbox_providers/host_provider.py | git, terminal, filesystem, permissions, external_network |
| backend/app/services/sandbox_providers/types.py | terminal, filesystem |
| backend/app/services/search.py | git, terminal, filesystem, external_network |
| backend/app/services/session_registry.py | permissions |
| backend/app/services/skill.py | filesystem, permissions, external_network |
| backend/app/services/storage.py | filesystem, permissions |
| backend/app/services/streaming/runtime.py | git, filesystem, permissions |
| backend/app/services/streaming/types.py | secrets, permissions |
| backend/app/services/terminal.py | terminal, filesystem, external_network |
| backend/app/services/user.py | git, filesystem, secrets |
| backend/app/services/workspace.py | git, terminal, filesystem, secrets, external_network |
| backend/app/utils/cache.py | filesystem |
| backend/app/utils/parsing.py | terminal |
| backend/app/utils/sandbox.py | git, terminal, filesystem, permissions |
| backend/migrate.py | terminal |
| backend/migrations/env.py | filesystem, secrets |
| backend/migrations/versions/05d565131567_add_chat_checkpoints.py | git, filesystem |
| backend/migrations/versions/b7fae3df7bca_initial_schema.py | git, filesystem, secrets, external_network |
| backend/pyproject.toml | git, filesystem, permissions, external_network |
| backend/seed_data.py | git, external_network |
| backend/tests/bootstrap.py | filesystem, secrets, external_network |
| backend/tests/conftest.py | git, external_network |
| backend/tests/helpers.py | git, terminal, filesystem, external_network |
| backend/tests/test_attachments.py | git, filesystem, permissions, external_network |
| backend/tests/test_auth.py | git, permissions, external_network |
| backend/tests/test_chat.py | git, terminal, filesystem, permissions, external_network |
| backend/tests/test_github.py | git, permissions, external_network |
| backend/tests/test_models.py | permissions, external_network |
| backend/tests/test_sandbox.py | git, terminal, filesystem, secrets, external_network |
| backend/tests/test_settings.py | git, secrets, permissions, external_network |
| backend/tests/test_skills.py | filesystem, permissions, external_network |
| backend/tests/test_websocket.py | git, terminal, filesystem, permissions, external_network |
| backend/tests/test_workspace.py | git, terminal, filesystem, permissions, external_network |
| desktop/entry.py | filesystem, external_network |
| frontend/package.json | git, filesystem |
| frontend/src/components/chat/branch-selector/BranchSelector.tsx | git, filesystem |
| frontend/src/components/chat/chat-search/ChatSearchPanel.tsx | git |
| frontend/src/components/chat/chat-window/AgentPane.tsx | terminal, filesystem |
| frontend/src/components/chat/chat-window/Chat.tsx | git, terminal, filesystem, permissions |
| frontend/src/components/chat/chat-window/ChatSessionOrchestrator.tsx | terminal, filesystem, permissions |
| frontend/src/components/chat/chat-window/QueueMessageCard.tsx | filesystem |
| frontend/src/components/chat/github/CreateBranchDialog.tsx | git, filesystem, external_network |
| frontend/src/components/chat/github/CreateCommitDialog.tsx | git, filesystem, permissions, external_network |
| frontend/src/components/chat/github/CreatePRDialog.tsx | git, filesystem, permissions, external_network |
| frontend/src/components/chat/message-bubble/ChangedFilesPanel.tsx | git, filesystem, external_network |
| frontend/src/components/chat/message-bubble/Message.tsx | git, filesystem, permissions |
| frontend/src/components/chat/message-bubble/MessageRenderer.tsx | git |
| frontend/src/components/chat/message-bubble/segmentBuilder.ts | git, filesystem |
| frontend/src/components/chat/message-input/AttachButton.tsx | filesystem, permissions |
| frontend/src/components/chat/message-input/DropIndicator.tsx | filesystem |
| frontend/src/components/chat/message-input/EnhanceButton.tsx | permissions |
| frontend/src/components/chat/message-input/Input.tsx | terminal, filesystem |
| frontend/src/components/chat/message-input/InputAttachments.tsx | filesystem |
| frontend/src/components/chat/message-input/InputContext.ts | terminal, filesystem |
| frontend/src/components/chat/message-input/InputControls.tsx | git, filesystem, permissions |
| frontend/src/components/chat/message-input/InputProvider.tsx | terminal, filesystem, permissions |
| frontend/src/components/chat/message-input/InputSuggestionsPanel.tsx | terminal, filesystem |
| frontend/src/components/chat/message-input/MentionIcon.tsx | filesystem |
| frontend/src/components/chat/message-input/MentionSuggestionsPanel.tsx | filesystem |
| frontend/src/components/chat/message-input/SendButton.tsx | permissions |
| frontend/src/components/chat/message-input/SlashCommandsPanel.tsx | terminal |
| frontend/src/components/chat/message-input/SuggestionPanel.tsx | git |
| frontend/src/components/chat/message-input/Textarea.tsx | permissions |
| frontend/src/components/chat/model-selector/ModelSelector.tsx | git |
| frontend/src/components/chat/permission-mode-selector/PermissionModeSelector.tsx | permissions |
| frontend/src/components/chat/permission-mode-selector/permissionModes.ts | terminal, filesystem, permissions |
| frontend/src/components/chat/sub-threads/CreateSubThreadDialog.tsx | git, terminal, permissions |
| frontend/src/components/chat/thinking-mode-selector/thinkingModes.ts | terminal |
| frontend/src/components/chat/tools/ToolPermissionInline.tsx | git, terminal, permissions |
| frontend/src/components/chat/tools/claude/AgentOutputTool.tsx | terminal |
| frontend/src/components/chat/tools/claude/BashTool.tsx | terminal |
| frontend/src/components/chat/tools/claude/FileOperationTool.tsx | git, filesystem |
| frontend/src/components/chat/tools/claude/GlobTool.tsx | filesystem |
| frontend/src/components/chat/tools/claude/GrepTool.tsx | filesystem |
| frontend/src/components/chat/tools/claude/KillShellTool.tsx | terminal |
| frontend/src/components/chat/tools/claude/LSPTool.tsx | filesystem |
| frontend/src/components/chat/tools/claude/NotebookEditTool.tsx | filesystem |
| frontend/src/components/chat/tools/claude/PlanModeTool.tsx | terminal, permissions |
| frontend/src/components/chat/tools/claude/TodoWrite.tsx | filesystem |
| frontend/src/components/chat/tools/codex/EditTool.tsx | git, filesystem |
| frontend/src/components/chat/tools/codex/FileActionTool.tsx | filesystem |
| frontend/src/components/chat/tools/codex/ReadTool.tsx | terminal, filesystem |
| frontend/src/components/chat/tools/codex/SearchTool.tsx | terminal, filesystem |
| frontend/src/components/chat/tools/codex/ShellTool.tsx | terminal, filesystem |
| frontend/src/components/chat/tools/codex/codexShellPayload.tsx | terminal, filesystem |
| frontend/src/components/chat/tools/common/DiffView.tsx | git, filesystem |
| frontend/src/components/chat/tools/common/OpenInEditorButton.tsx | filesystem, external_network |
| frontend/src/components/chat/tools/common/buildUnifiedDiff.ts | git |
| frontend/src/components/chat/tools/copilot/EditTool.tsx | git, filesystem |
| frontend/src/components/chat/tools/copilot/ExecuteTool.tsx | terminal |
| frontend/src/components/chat/tools/copilot/ReadTool.tsx | filesystem |
| frontend/src/components/chat/tools/copilot/copilotPayload.ts | git, terminal, filesystem |
| frontend/src/components/chat/tools/cursor/EditTool.tsx | git, terminal, filesystem |
| frontend/src/components/chat/tools/cursor/ExecuteTool.tsx | terminal |
| frontend/src/components/chat/tools/cursor/ReadTool.tsx | filesystem |
| frontend/src/components/chat/tools/cursor/SearchTool.tsx | filesystem |
| frontend/src/components/chat/tools/cursor/cursorPayload.ts | git, terminal, filesystem |
| frontend/src/components/chat/tools/opencode/BashTool.tsx | terminal |
| frontend/src/components/chat/tools/opencode/EditTool.tsx | git, filesystem |
| frontend/src/components/chat/tools/opencode/GlobTool.tsx | filesystem |
| frontend/src/components/chat/tools/opencode/GrepTool.tsx | filesystem |
| frontend/src/components/chat/tools/opencode/ReadTool.tsx | filesystem |
| frontend/src/components/chat/tools/opencode/TodoWriteTool.tsx | filesystem |
| frontend/src/components/chat/tools/opencode/WriteTool.tsx | filesystem |
| frontend/src/components/chat/tools/opencode/opencodePayload.ts | terminal, filesystem |
| frontend/src/components/chat/tools/registry.tsx | git, terminal, filesystem |
| frontend/src/components/chat/workspace-selector/WorkspaceSelector.tsx | git, terminal, filesystem, external_network |
| frontend/src/components/chat/worktree-selector/WorktreeToggle.tsx | git, permissions |
| frontend/src/components/editor/code-sidebar/CodeSidebar.tsx | filesystem |
| frontend/src/components/editor/code-view/CodeView.tsx | git, terminal, filesystem |
| frontend/src/components/editor/editor-core/Editor.tsx | filesystem |
| frontend/src/components/editor/editor-view/Content.tsx | filesystem |
| frontend/src/components/editor/editor-view/EmptyState.tsx | terminal, filesystem |
| frontend/src/components/editor/editor-view/Header.tsx | filesystem |
| frontend/src/components/editor/editor-view/View.tsx | terminal, filesystem |
| frontend/src/components/editor/file-preview/CsvPreview.tsx | terminal, filesystem |
| frontend/src/components/editor/file-preview/FilePreview.tsx | filesystem |
| frontend/src/components/editor/file-preview/HtmlPreview.tsx | terminal, filesystem, permissions |
| frontend/src/components/editor/file-preview/ImagePreview.tsx | terminal, filesystem |
| frontend/src/components/editor/file-preview/MarkdownPreview.tsx | filesystem |
| frontend/src/components/editor/file-preview/PDFPreview.tsx | terminal, filesystem |
| frontend/src/components/editor/file-preview/PowerPointPreview.tsx | git, terminal, filesystem, permissions |
| frontend/src/components/editor/file-preview/PreviewContainer.tsx | filesystem |
| frontend/src/components/editor/file-preview/PreviewEmptyState.tsx | terminal, filesystem |
| frontend/src/components/editor/file-preview/PreviewHeader.tsx | filesystem |
| frontend/src/components/editor/file-preview/XlsxPreview.tsx | terminal, filesystem |
| frontend/src/components/editor/file-preview/previewConstants.ts | filesystem |
| frontend/src/components/editor/file-preview/previewUtils.ts | filesystem |
| frontend/src/components/editor/file-search/SearchPanel.tsx | filesystem |
| frontend/src/components/editor/file-search/SearchResultGroup.tsx | filesystem |
| frontend/src/components/editor/file-search/SearchResultLine.tsx | filesystem |
| frontend/src/components/editor/file-tree/Tree.tsx | git, terminal, filesystem, external_network |
| frontend/src/components/layout/ChatDropdown.tsx | filesystem |
| frontend/src/components/layout/Header.tsx | filesystem |
| frontend/src/components/layout/Layout.tsx | git |
| frontend/src/components/layout/Sidebar.tsx | filesystem, external_network |
| frontend/src/components/layout/TitleBar.tsx | terminal |
| frontend/src/components/layout/UserProfileMenu.tsx | filesystem |
| frontend/src/components/sandbox/git/DiffView.tsx | git, terminal, filesystem, permissions, external_network |
| frontend/src/components/sandbox/git/PRReviewView.tsx | git, filesystem, external_network |
| frontend/src/components/sandbox/secrets/SecretsView.tsx | terminal, filesystem, secrets |
| frontend/src/components/sandbox/terminal/Container.tsx | terminal, filesystem |
| frontend/src/components/sandbox/terminal/TerminalTab.tsx | git, terminal, filesystem, external_network |
| frontend/src/components/settings/dialogs/EnvVarDialog.tsx | filesystem, secrets |
| frontend/src/components/settings/dialogs/SkillEditDialog.tsx | git, filesystem |
| frontend/src/components/settings/inputs/SecretInput.tsx | secrets |
| frontend/src/components/settings/sections/EnvVarsSection.tsx | filesystem, secrets |
| frontend/src/components/settings/sections/PersonasSection.tsx | filesystem |
| frontend/src/components/settings/tabs/EnvVarsSettingsTab.tsx | terminal, filesystem |
| frontend/src/components/settings/tabs/GeneralSettingsTab.tsx | filesystem, secrets, permissions |
| frontend/src/components/settings/tabs/PersonasSettingsTab.tsx | terminal, filesystem |
| frontend/src/components/settings/tabs/SkillsSettingsTab.tsx | filesystem |
| frontend/src/components/ui/AttachmentViewer.tsx | filesystem |
| frontend/src/components/ui/CommandMenu.tsx | git, terminal, filesystem |
| frontend/src/components/ui/FilePreviewList.tsx | filesystem |
| frontend/src/components/ui/FileUploadDialog.tsx | filesystem |
| frontend/src/components/ui/ImagePreviewModal.tsx | filesystem |
| frontend/src/components/ui/ListManagementTab.tsx | terminal, filesystem |
| frontend/src/components/ui/MarkDown.tsx | git, filesystem |
| frontend/src/components/ui/Mermaid.tsx | filesystem |
| frontend/src/components/ui/MosaicSplitView.tsx | git, terminal, secrets |
| frontend/src/components/ui/VisualWidget.tsx | filesystem, permissions |
| frontend/src/components/ui/commandRegistry.ts | git, terminal, filesystem, secrets |
| frontend/src/components/ui/primitives/Dropdown.tsx | git, permissions |
| frontend/src/components/ui/primitives/Input.tsx | permissions |
| frontend/src/components/ui/primitives/SegmentedControl.tsx | git, permissions |
| frontend/src/components/ui/primitives/Select.tsx | permissions |
| frontend/src/components/ui/primitives/Switch.tsx | permissions |
| frontend/src/components/ui/primitives/Textarea.tsx | permissions |
| frontend/src/components/ui/primitives/inputStyles.ts | permissions |
| frontend/src/components/ui/shared/ApprovalFooter.tsx | permissions |
| frontend/src/components/ui/shared/FileIcon.tsx | filesystem |
| frontend/src/components/ui/shared/HighlightMatch.tsx | git |
| frontend/src/components/ui/shared/SaveButton.tsx | permissions |
| frontend/src/config/constants.ts | git, terminal |
| frontend/src/contexts/ChatContext.tsx | terminal, filesystem |
| frontend/src/contexts/ChatContextDefinition.ts | terminal, filesystem |
| frontend/src/contexts/ChatSessionContextDefinition.ts | filesystem, permissions |
| frontend/src/hooks/queries/queryKeys.ts | git, filesystem, secrets, external_network |
| frontend/src/hooks/queries/useChatQueries.ts | git, filesystem |
| frontend/src/hooks/queries/useGitHubQueries.ts | git, external_network |
| frontend/src/hooks/queries/useModelQueries.ts | terminal |
| frontend/src/hooks/queries/useSandboxQueries.ts | git, terminal, filesystem, secrets, external_network |
| frontend/src/hooks/queries/useWorkspaceQueries.ts | filesystem |
| frontend/src/hooks/useAgentToolsContext.ts | terminal |
| frontend/src/hooks/useAuthForm.ts | filesystem |
| frontend/src/hooks/useChatStreaming.ts | git, filesystem, permissions |
| frontend/src/hooks/useCheckpointRestore.ts | git, filesystem |
| frontend/src/hooks/useClipboard.ts | filesystem |
| frontend/src/hooks/useCommandMenu.ts | terminal |
| frontend/src/hooks/useContextUsageState.ts | git, filesystem |
| frontend/src/hooks/useCrudForm.ts | git, filesystem |
| frontend/src/hooks/useDragAndDrop.ts | filesystem |
| frontend/src/hooks/useEditorState.ts | filesystem |
| frontend/src/hooks/useEditorTheme.ts | permissions |
| frontend/src/hooks/useExitPlanMode.ts | permissions |
| frontend/src/hooks/useFileHandling.ts | filesystem |
| frontend/src/hooks/useInputFileOperations.ts | filesystem |
| frontend/src/hooks/useInputState.ts | filesystem |
| frontend/src/hooks/useMentionSuggestions.ts | filesystem |
| frontend/src/hooks/useMessageActions.ts | terminal, filesystem, permissions |
| frontend/src/hooks/useMessageCache.ts | filesystem |
| frontend/src/hooks/useMessageInitialization.ts | git, filesystem, permissions |
| frontend/src/hooks/usePdfBlobCache.ts | filesystem |
| frontend/src/hooks/usePendingFileOpen.ts | filesystem |
| frontend/src/hooks/usePermissionRequest.ts | permissions |
| frontend/src/hooks/useSandboxFiles.ts | filesystem |
| frontend/src/hooks/useSlashCommandSuggestions.ts | terminal |
| frontend/src/hooks/useStreamCallbacks.ts | git, terminal, filesystem, permissions |
| frontend/src/hooks/useStreamReconnect.ts | git, filesystem |
| frontend/src/hooks/useStreamRestoration.ts | git, filesystem |
| frontend/src/hooks/useSuggestionBase.ts | terminal |
| frontend/src/hooks/useToggleSet.ts | filesystem |
| frontend/src/hooks/useXterm.ts | terminal, filesystem |
| frontend/src/lib/api.ts | terminal, filesystem, external_network |
| frontend/src/pages/ChatPage.tsx | git, terminal, filesystem, secrets, external_network |
| frontend/src/pages/LandingPage.tsx | terminal, filesystem, secrets |
| frontend/src/pages/SettingsPage.tsx | git, filesystem, secrets, external_network |
| frontend/src/services/base/BaseService.ts | terminal, external_network |
| frontend/src/services/chatService.ts | git, filesystem, permissions |
| frontend/src/services/desktopUpdateService.ts | filesystem |
| frontend/src/services/githubService.ts | git, external_network |
| frontend/src/services/permissionService.ts | permissions |
| frontend/src/services/queueService.ts | filesystem, permissions |
| frontend/src/services/sandboxService.ts | git, filesystem, secrets |
| frontend/src/services/skillService.ts | filesystem |
| frontend/src/services/streamService.ts | git, terminal, filesystem, permissions |
| frontend/src/services/workspaceService.ts | filesystem |
| frontend/src/store/chatSettingsStore.ts | permissions |
| frontend/src/store/chatStore.ts | filesystem |
| frontend/src/store/messageQueueStore.ts | terminal, filesystem, permissions |
| frontend/src/store/permissionStore.ts | filesystem, permissions |
| frontend/src/store/streamStore.ts | filesystem |
| frontend/src/store/uiStore.ts | git, terminal, filesystem, permissions |
| frontend/src/store/updateStore.ts | filesystem |
| frontend/src/types/chat.types.ts | filesystem, permissions |
| frontend/src/types/diff.d.ts | git |
| frontend/src/types/file-system.types.ts | filesystem |
| frontend/src/types/github.types.ts | git, external_network |
| frontend/src/types/queue.types.ts | filesystem, permissions |
| frontend/src/types/sandbox.types.ts | git, terminal, filesystem, secrets |
| frontend/src/types/settings.types.ts | git, secrets, external_network |
| frontend/src/types/stream.types.ts | terminal, permissions |
| frontend/src/types/tools.types.ts | permissions |
| frontend/src/types/ui.types.ts | git, terminal, filesystem, secrets |
| frontend/src/types/user.types.ts | git, filesystem, secrets, external_network |
| frontend/src/types/workspace.types.ts | git, terminal, filesystem |
| frontend/src/utils/attachmentUrl.ts | filesystem, external_network |
| frontend/src/utils/date.ts | git |
| frontend/src/utils/file.ts | git, terminal, filesystem, external_network |
| frontend/src/utils/fileTypes.ts | filesystem, permissions |
| frontend/src/utils/format.ts | filesystem |
| frontend/src/utils/logger.ts | git |
| frontend/src/utils/message.ts | filesystem |
| frontend/src/utils/mosaicHelpers.ts | git |
| frontend/src/utils/notifications.ts | permissions |
| frontend/src/utils/permissionResponse.ts | permissions |
| frontend/src/utils/permissionStorage.ts | permissions |
| frontend/src/utils/settings.ts | git, secrets, external_network |
| frontend/src/utils/storage.ts | git, filesystem, permissions |
| frontend/src/utils/stream.ts | git, filesystem |
| frontend/src/utils/terminal.ts | terminal |
| frontend/src-tauri/capabilities/default.json | permissions |
| frontend/src-tauri/src/main.rs | git, terminal, filesystem, secrets, external_network |
| frontend/src-tauri/tauri.conf.json | git, terminal, filesystem, external_network |
| frontend/tsconfig.app.json | permissions |
| frontend/tsconfig.json | filesystem |
| frontend/tsconfig.node.json | permissions |
| frontend/vite.config.ts | git, terminal, filesystem, external_network |
