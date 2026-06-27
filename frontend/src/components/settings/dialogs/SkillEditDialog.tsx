import { useState, useEffect, lazy, Suspense, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter';
import { DialogError } from '@/components/ui/shared/DialogError';
import { Tree } from '@/components/editor/file-tree/Tree';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import type { CustomSkill } from '@/types/user.types';
import type { FileStructure } from '@/types/file-system.types';
import { skillService, type SkillFileEntry } from '@/services/skillService';
import { detectLanguage, sortFiles } from '@/utils/file';
import { MONACO_FONT_FAMILY } from '@/config/constants';

const Editor = lazy(() => import('@monaco-editor/react'));

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  padding: { top: 8, bottom: 8 },
  automaticLayout: true,
  fontFamily: MONACO_FONT_FAMILY,
  fontSize: 12,
  scrollbar: {
    useShadows: false,
    vertical: 'auto',
    horizontal: 'auto',
    horizontalScrollbarSize: 6,
    verticalScrollbarSize: 6,
  },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
} as const;

interface SkillEditDialogProps {
  isOpen: boolean;
  workspaceId: string;
  skill: CustomSkill | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const SkillEditDialog: React.FC<SkillEditDialogProps> = ({
  isOpen,
  workspaceId,
  skill,
  onClose,
  onSaved,
}) => {
  const [files, setFiles] = useState<SkillFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileStructure | null>(null);
  const [modifiedFiles, setModifiedFiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = useResolvedTheme();

  const fileTree = useMemo(() => skillFilesToFileTree(files), [files]);
  const modifiedPathsKey = useMemo(
    () => [...modifiedFiles.keys()].sort().join('\0'),
    [modifiedFiles],
  );
  const modifiedPaths = useMemo(
    () => new Set(modifiedPathsKey ? modifiedPathsKey.split('\0') : []),
    [modifiedPathsKey],
  );

  useEffect(() => {
    if (!isOpen || !skill) return;
    setFiles([]);
    setSelectedFile(null);
    setModifiedFiles(new Map());
    setError(null);
    setLoading(true);

    let cancelled = false;
    void skillService
      .getSkillFiles(workspaceId, skill.sources[0], skill.name)
      .then((loaded) => {
        if (cancelled) return;
        setFiles(loaded);
        const firstTextFile = loaded.find((file) => !file.is_binary);
        if (firstTextFile) {
          setSelectedFile({
            path: firstTextFile.path,
            content: firstTextFile.content,
            type: 'file',
            is_binary: false,
          });
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load skill files');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, skill, workspaceId]);

  const selectedSkillFile = useMemo(
    () => files.find((file) => file.path === selectedFile?.path) ?? null,
    [files, selectedFile],
  );

  const currentContent = useMemo(() => {
    if (!selectedSkillFile) return '';
    const modified = modifiedFiles.get(selectedSkillFile.path);
    return modified ?? selectedSkillFile.content;
  }, [selectedSkillFile, modifiedFiles]);

  const hasChanges = modifiedFiles.size > 0;

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!selectedFile) return;
      const original = files.find((file) => file.path === selectedFile.path);
      if (!original) return;

      setModifiedFiles((previous) => {
        const next = new Map(previous);
        if ((value ?? '') === original.content) {
          next.delete(selectedFile.path);
        } else {
          next.set(selectedFile.path, value ?? '');
        }
        return next;
      });
    },
    [files, selectedFile],
  );

  const handleSave = useCallback(async () => {
    if (!skill) return;

    setSaving(true);
    setError(null);
    try {
      const merged = files.map((file) => {
        const modified = modifiedFiles.get(file.path);
        return modified === undefined ? file : { ...file, content: modified };
      });
      await skillService.updateSkill(workspaceId, skill.sources[0], skill.name, merged);
      await onSaved();
      onClose();
      toast.success('Skill updated');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update skill');
    } finally {
      setSaving(false);
    }
  }, [files, modifiedFiles, onClose, onSaved, skill, workspaceId]);

  if (!isOpen || !skill) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="4xl" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3 dark:border-border-dark">
        <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
          Edit Skill: {skill.name}
        </h3>
      </div>

      <div className="flex h-[600px]">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border dark:border-border-dark">
          {loading ? (
            <div className="p-4 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Loading files...
            </div>
          ) : (
            <Tree
              files={fileTree}
              selectedFile={selectedFile}
              onFileSelect={setSelectedFile}
              modifiedPaths={modifiedPaths}
            />
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {!selectedSkillFile ? (
            <div className="flex h-full items-center justify-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              {loading ? 'Loading...' : 'Select a file to edit'}
            </div>
          ) : selectedSkillFile.is_binary ? (
            <div className="flex h-full items-center justify-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              Binary file cannot be edited
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                  Loading editor...
                </div>
              }
            >
              <Editor
                height="100%"
                language={detectLanguage(selectedSkillFile.path)}
                value={currentContent}
                onChange={handleEditorChange}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                options={EDITOR_OPTIONS}
              />
            </Suspense>
          )}
        </div>
      </div>

      <DialogError error={error} />
      <DialogFooter
        onCancel={onClose}
        onSave={handleSave}
        saveLabel="Save Changes"
        saving={saving}
        disabled={!hasChanges || loading}
        bordered
      />
    </BaseModal>
  );
};

function skillFilesToFileTree(files: SkillFileEntry[]): FileStructure[] {
  const root: FileStructure[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let index = 0; index < parts.length; index += 1) {
      const isLast = index === parts.length - 1;
      const partPath = parts.slice(0, index + 1).join('/');

      let existing = current.find((item) => item.path === partPath);
      if (!existing) {
        existing = isLast
          ? {
              path: partPath,
              content: file.content,
              type: 'file',
              is_binary: file.is_binary,
            }
          : { path: partPath, content: '', type: 'folder', children: [] };
        current.push(existing);
      }

      if (!isLast) {
        if (!existing.children) existing.children = [];
        current = existing.children;
      }
    }
  }

  return sortFiles(root);
}
