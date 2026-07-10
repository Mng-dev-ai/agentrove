// Grok Build speaks ACP with its raw tool names surfaced in
// _meta["x.ai/tool"].name (backend extracts it as tool_name for grok); web
// search calls lack that meta and fall through to the ACP kind "search".
//
// rawOutput is a variant-tagged dict, e.g. {"type": "Bash", ...flat fields}
// for terminal commands or {"type": "ReadFile", "FileContent": {...}} for
// reads. rawInput shapes below mirror the tool argument payloads Grok emits.

export interface GrokBashInput {
  command?: string;
  description?: string;
  is_background?: boolean;
}

export interface GrokBashOutput {
  output_for_prompt?: string;
  exit_code?: number;
  command?: string;
  truncated?: boolean;
}

export interface GrokWriteInput {
  file_path?: string;
  content?: string;
}

export interface GrokEditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

export interface GrokReadInput {
  target_file?: string;
  offset?: number;
}

export interface GrokReadOutput {
  FileContent?: {
    // `content` is line-numbered for the prompt; raw_output is the plain text.
    content?: string;
    raw_output?: string;
    absolute_path?: string;
    total_lines?: number;
  };
}

export interface GrokListDirInput {
  target_directory?: string;
}

export interface GrokListDirOutput {
  Content?: unknown;
}

export interface GrokGrepInput {
  pattern?: string;
  path?: string;
  glob?: string | null;
}

export interface GrokGrepOutput {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  match_count?: number;
  file_matches?: number;
}

export interface GrokWebFetchInput {
  url?: string;
}

export interface GrokWebFetchOutput {
  Content?: {
    url?: string;
    content?: string;
    content_type?: string;
  };
}

export interface GrokTodoInfo {
  id?: string;
  content?: string | null;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface GrokTodoWriteInput {
  todos?: GrokTodoInfo[];
  merge?: boolean;
}
