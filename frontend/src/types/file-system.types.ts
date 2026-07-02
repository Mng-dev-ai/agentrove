export interface FileStructure {
  path: string;
  content: string;
  type: 'file' | 'folder';
  is_binary?: boolean;
  children?: FileStructure[];
}
