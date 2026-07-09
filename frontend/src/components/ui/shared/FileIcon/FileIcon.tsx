import { memo, useState, useEffect } from 'react';
import clsx from 'clsx';
import { Folder, FolderOpen } from 'lucide-react';
import styles from './FileIcon.module.scss';

type GetIconFn = (name: string) => { svg: string };

let cachedGetIcon: GetIconFn | null = null;
let loadPromise: Promise<GetIconFn | null> | null = null;
const svgCache = new Map<string, string>();

function getSvg(name: string): string | null {
  const cached = svgCache.get(name);
  if (cached) return cached;
  if (!cachedGetIcon) return null;
  const svg = cachedGetIcon(name).svg;
  svgCache.set(name, svg);
  return svg;
}

function loadModule(): Promise<GetIconFn | null> {
  if (!loadPromise) {
    loadPromise = import('material-file-icons').then(
      (m) => {
        cachedGetIcon = m.getIcon as GetIconFn;
        return cachedGetIcon;
      },
      () => {
        loadPromise = null;
        return null;
      },
    );
  }
  return loadPromise;
}

export interface FolderIconProps {
  isExpanded?: boolean;
  className?: string;
}

export const FolderIcon = memo(function FolderIcon({ isExpanded, className }: FolderIconProps) {
  const Icon = isExpanded ? FolderOpen : Folder;
  return <Icon className={clsx(styles['folder-icon'], className)} />;
});

export interface FileIconProps {
  name: string;
  className?: string;
}

export const FileIcon = memo(function FileIcon({ name, className }: FileIconProps) {
  const [svg, setSvg] = useState<string | null>(() => getSvg(name));

  useEffect(() => {
    const resolved = getSvg(name);
    if (resolved) {
      setSvg(resolved);
      return;
    }
    setSvg(null);
    let cancelled = false;
    loadModule().then((getIcon) => {
      if (!cancelled && getIcon) setSvg(getSvg(name));
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!svg) return <span className={clsx(styles['file-icon'], className)} />;

  return (
    <span
      className={clsx(styles['file-icon'], className)}
      role="img"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
