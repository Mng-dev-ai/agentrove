export interface AntigravityReadInput {
  absolute_path?: string;
}

export interface AntigravityExecuteInput {
  command_line?: string;
  working_dir?: string;
}

export interface AntigravityExecuteOutput {
  commandLine?: string;
  workingDir?: string;
  exitCode?: number;
  exit_code?: number;
  combinedOutput?: string;
  formatted_output?: string;
}

export interface AntigravityDiffBlock {
  path?: string | null;
  oldText?: string | null;
  newText?: string | null;
}

export interface AntigravityEditOutput {
  diffs?: AntigravityDiffBlock[];
}
