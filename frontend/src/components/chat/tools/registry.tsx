import { lazy } from 'react';
import type { ToolComponent } from '@/types/ui.types';
import type { AgentKind } from '@/types/chat.types';
type ToolModuleLoader = () => Promise<{ default: ToolComponent }>;

const toLazy = (loader: ToolModuleLoader): ToolComponent =>
  lazy(loader) as unknown as ToolComponent;

const codexShellLoader: ToolModuleLoader = () =>
  import('./codex/ShellTool').then((m) => ({ default: m.ShellTool }));

// Codex kinds that need shape-specific renderers beyond the shared lowercase
// table below: Guardian auto-approval reviews arrive as kind "think", and kind
// "other" covers both image generation and collab-agent tool calls.
const codexToolLoaders: Record<string, ToolModuleLoader> = {
  think: () =>
    import('./codex/GuardianReviewTool').then((m) => ({ default: m.GuardianReviewTool })),
  other: () => import('./codex/OtherTool').then((m) => ({ default: m.OtherTool })),
};

const copilotToolLoaders: Record<string, ToolModuleLoader> = {
  execute: () => import('./copilot/ExecuteTool').then((m) => ({ default: m.ExecuteTool })),
  read: () => import('./copilot/ReadTool').then((m) => ({ default: m.ReadTool })),
  edit: () => import('./copilot/EditTool').then((m) => ({ default: m.EditTool })),
  fetch: () => import('./copilot/FetchTool').then((m) => ({ default: m.FetchTool })),
  // Copilot uses `kind: "other"` for sub-agent invocations.
  other: () => import('./copilot/AgentTool').then((m) => ({ default: m.AgentTool })),
};

const cursorToolLoaders: Record<string, ToolModuleLoader> = {
  execute: () => import('./cursor/ExecuteTool').then((m) => ({ default: m.ExecuteTool })),
  read: () => import('./cursor/ReadTool').then((m) => ({ default: m.ReadTool })),
  search: () => import('./cursor/SearchTool').then((m) => ({ default: m.SearchTool })),
  edit: () => import('./cursor/EditTool').then((m) => ({ default: m.EditTool })),
};

// OpenCode uses the raw tool names (bash, read, edit, write, grep, glob,
// webfetch, task, todowrite, skill, question) rather than ACP kinds — the
// backend's tool-name extractor picks these out of the ACP `title` field for
// opencode sessions, since opencode's ACP kinds collapse distinct tools
// (edit/write/patch all share kind "edit").
const opencodeToolLoaders: Record<string, ToolModuleLoader> = {
  bash: () => import('./opencode/BashTool').then((m) => ({ default: m.BashTool })),
  read: () => import('./opencode/ReadTool').then((m) => ({ default: m.ReadTool })),
  write: () => import('./opencode/WriteTool').then((m) => ({ default: m.WriteTool })),
  edit: () => import('./opencode/EditTool').then((m) => ({ default: m.EditTool })),
  patch: () => import('./opencode/EditTool').then((m) => ({ default: m.EditTool })),
  grep: () => import('./opencode/GrepTool').then((m) => ({ default: m.GrepTool })),
  glob: () => import('./opencode/GlobTool').then((m) => ({ default: m.GlobTool })),
  webfetch: () => import('./opencode/WebFetchTool').then((m) => ({ default: m.WebFetchTool })),
  task: () => import('./opencode/TaskTool').then((m) => ({ default: m.TaskTool })),
  todowrite: () => import('./opencode/TodoWriteTool').then((m) => ({ default: m.TodoWriteTool })),
  skill: () => import('./opencode/SkillTool').then((m) => ({ default: m.SkillTool })),
  question: () => import('./opencode/QuestionTool').then((m) => ({ default: m.QuestionTool })),
};

const toolLoaders: Record<string, ToolModuleLoader> = {
  // Claude Code tools
  Agent: () => import('./claude/AgentTool').then((m) => ({ default: m.AgentTool })),
  WebSearch: () => import('./claude/WebSearch').then((m) => ({ default: m.WebSearch })),
  TodoWrite: () => import('./claude/TodoWrite').then((m) => ({ default: m.TodoWrite })),
  Write: () => import('./claude/FileOperationTool').then((m) => ({ default: m.WriteTool })),
  Read: () => import('./claude/FileOperationTool').then((m) => ({ default: m.ReadTool })),
  Edit: () => import('./claude/FileOperationTool').then((m) => ({ default: m.EditTool })),
  Bash: () => import('./claude/BashTool').then((m) => ({ default: m.BashTool })),
  Glob: () => import('./claude/GlobTool').then((m) => ({ default: m.GlobTool })),
  Grep: () => import('./claude/GrepTool').then((m) => ({ default: m.GrepTool })),
  NotebookEdit: () =>
    import('./claude/NotebookEditTool').then((m) => ({ default: m.NotebookEditTool })),
  WebFetch: () => import('./claude/WebFetchTool').then((m) => ({ default: m.WebFetchTool })),
  LSP: () => import('./claude/LSPTool').then((m) => ({ default: m.LSPTool })),
  AgentOutput: () =>
    import('./claude/AgentOutputTool').then((m) => ({ default: m.AgentOutputTool })),
  BashOutput: () => import('./claude/AgentOutputTool').then((m) => ({ default: m.BashOutputTool })),
  KillShell: () => import('./claude/KillShellTool').then((m) => ({ default: m.KillShellTool })),
  EnterPlanMode: () =>
    import('./claude/PlanModeTool').then((m) => ({ default: m.EnterPlanModeTool })),
  ExitPlanMode: () =>
    import('./claude/PlanModeTool').then((m) => ({ default: m.ExitPlanModeTool })),

  // Codex tools (lowercase kind values from ACP)
  execute: codexShellLoader,
  search: () => import('./codex/SearchTool').then((m) => ({ default: m.SearchTool })),
  read: () => import('./codex/ReadTool').then((m) => ({ default: m.ReadTool })),
  edit: () => import('./codex/EditTool').then((m) => ({ default: m.EditTool })),
  fetch: () => import('./codex/FetchTool').then((m) => ({ default: m.FetchTool })),
  delete: () => import('./codex/FileActionTool').then((m) => ({ default: m.DeleteTool })),
  move: () => import('./codex/FileActionTool').then((m) => ({ default: m.MoveTool })),
};

const mcpLoader: ToolModuleLoader = () =>
  import('./claude/MCPTool').then((m) => ({ default: m.MCPTool }));
const webSearchLoader: ToolModuleLoader = () =>
  import('./claude/WebSearch').then((m) => ({ default: m.WebSearch }));

const lazyToolComponents = new Map<string, ToolComponent>();

const getOrCreateLazy = (key: string, loader: ToolModuleLoader) => {
  const existing = lazyToolComponents.get(key);
  if (existing) return existing;
  const component = toLazy(loader);
  lazyToolComponents.set(key, component);
  return component;
};

export const getToolComponent = (toolName: string, agentKind?: AgentKind): ToolComponent => {
  // Copilot and Cursor both speak the lowercase ACP kinds (execute/read/edit/
  // fetch) that Codex uses, but emit different rawInput/rawOutput shapes.
  // Route each agent's tools to its own renderers before falling through to
  // the Codex/Claude table.
  if (agentKind === 'codex' && codexToolLoaders[toolName]) {
    return getOrCreateLazy(`codex:${toolName}`, codexToolLoaders[toolName]);
  }

  if (agentKind === 'copilot' && copilotToolLoaders[toolName]) {
    return getOrCreateLazy(`copilot:${toolName}`, copilotToolLoaders[toolName]);
  }

  if (agentKind === 'cursor' && cursorToolLoaders[toolName]) {
    return getOrCreateLazy(`cursor:${toolName}`, cursorToolLoaders[toolName]);
  }

  if (agentKind === 'opencode' && opencodeToolLoaders[toolName]) {
    return getOrCreateLazy(`opencode:${toolName}`, opencodeToolLoaders[toolName]);
  }

  if (toolLoaders[toolName]) {
    return getOrCreateLazy(toolName, toolLoaders[toolName]);
  }

  if (
    toolName.startsWith('mcp__web-search-prime__') ||
    toolName.startsWith('mcp__web_search_prime__')
  ) {
    return getOrCreateLazy(toolName, webSearchLoader);
  }

  return getOrCreateLazy(toolName, mcpLoader);
};
