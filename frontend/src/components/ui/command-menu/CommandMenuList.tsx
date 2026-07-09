import { Fragment, type Ref, type MouseEvent as ReactMouseEvent } from 'react';
import { GitBranch, File, MessageSquare, PanelRight, PanelBottom } from 'lucide-react';
import { Button } from '../primitives/Button/Button';
import { FloatingTooltip } from '../FloatingTooltip/FloatingTooltip';
import { HighlightMatch } from '../shared/HighlightMatch/HighlightMatch';
import { viewTypeToTileId } from '@/utils/tileHelpers';
import type { ThemeMeta } from '@/utils/theme';
import type { ViewType, SplitDirection, Theme } from '@/types/ui.types';
import type { GitBranchesData } from '@/types/sandbox.types';
import { MenuRow } from './MenuRow';
import {
  formatShortcut,
  type FlatFileItem,
  type CommandItem,
  type MenuListItem,
  type MenuMode,
} from './commandRegistry';
import styles from './CommandMenuList.module.scss';

interface CommandMenuListProps {
  mode: MenuMode;
  listId: string;
  activeIndex: number;
  activeItemRef: Ref<HTMLDivElement>;
  onActivate: (index: number, e: ReactMouseEvent) => void;
  query: string;
  trimmedQuery: string;
  isMobile: boolean;
  // Main mode
  listItems: MenuListItem[];
  leafTileIds: Set<string>;
  useSecondary: boolean;
  isChatSearchPending: boolean;
  onOpenChat: (id: string) => void;
  onSelectFile: (file: FlatFileItem) => void;
  onRunCommand: (cmd: CommandItem) => void;
  onSplit: (viewId: ViewType, direction: SplitDirection) => void;
  // Branches mode
  filteredBranches: string[];
  branchesData: GitBranchesData | undefined;
  sandboxId: string | undefined;
  checkoutPending: boolean;
  onSelectBranch: (branch: string) => void;
  // Themes mode
  filteredThemes: ThemeMeta[];
  theme: Theme;
  onSelectTheme: (value: Theme) => void;
}

export function CommandMenuList({
  mode,
  listId,
  activeIndex,
  activeItemRef,
  onActivate,
  query,
  trimmedQuery,
  isMobile,
  listItems,
  leafTileIds,
  useSecondary,
  isChatSearchPending,
  onOpenChat,
  onSelectFile,
  onRunCommand,
  onSplit,
  filteredBranches,
  branchesData,
  sandboxId,
  checkoutPending,
  onSelectBranch,
  filteredThemes,
  theme,
  onSelectTheme,
}: CommandMenuListProps) {
  const renderMainRow = (item: MenuListItem, index: number) => {
    const rowProps = {
      index,
      isActive: index === activeIndex,
      itemRef: index === activeIndex ? activeItemRef : undefined,
      onActivate,
      id: `menu-item-${index}`,
    };
    // Sections are contiguous by kind, so a header renders on each kind transition.
    const prevKind = listItems[index - 1]?.kind;
    const showHeader = mode === 'all' && prevKind !== item.kind;

    if (item.kind === 'chat') {
      const { chat } = item;
      return (
        <Fragment key={`chat-${chat.id}`}>
          {showHeader && (
            <p className={styles['section-header']}>{trimmedQuery ? 'Chats' : 'Recent chats'}</p>
          )}
          <MenuRow {...rowProps} onSelect={() => onOpenChat(chat.id)}>
            <MessageSquare className={styles['row-icon']} />
            <HighlightMatch
              text={chat.title}
              searchQuery={query}
              className={styles['chat-title']}
            />
            {/* Content hits show the match count — it explains why a title
                that doesn't match the query is listed. */}
            {(chat.matchCount != null || chat.workspaceName) && (
              <span className={styles.meta}>
                {chat.matchCount != null
                  ? `${chat.matchCount} ${chat.matchCount === 1 ? 'match' : 'matches'}`
                  : chat.workspaceName}
              </span>
            )}
          </MenuRow>
        </Fragment>
      );
    }

    if (item.kind === 'file') {
      const { file } = item;
      return (
        <Fragment key={`file-${file.path}`}>
          {showHeader && <p className={styles['section-header']}>Files</p>}
          <MenuRow {...rowProps} onSelect={() => onSelectFile(file)}>
            <File className={styles['row-icon']} />
            <span className={styles['file-line']}>
              <HighlightMatch
                text={file.name}
                searchQuery={query}
                className={styles['file-name']}
              />
              <span className={styles['file-path']}>{file.path}</span>
            </span>
          </MenuRow>
        </Fragment>
      );
    }

    const cmd = item.command;
    const Icon = cmd.icon;
    // Active/split state is scoped to the pane the user is in: the view counts as
    // active only if the active pane's target tile (e.g. editor:secondary) is
    // already on screen, so the split buttons stay available to surface it beside
    // the other panes.
    const isViewActive =
      cmd.type === 'view' && leafTileIds.has(viewTypeToTileId(cmd.id, useSecondary));
    return (
      <Fragment key={`command-${cmd.id}`}>
        {showHeader && <p className={styles['section-header']}>Actions</p>}
        <MenuRow
          {...rowProps}
          onSelect={() => onRunCommand(cmd)}
          trailing={
            <>
              {!isMobile && cmd.shortcut && (
                <kbd className={styles.kbd}>{formatShortcut(cmd.shortcut)}</kbd>
              )}
              {cmd.type === 'view' && !isMobile && !isViewActive && (
                <div className={styles['split-group']}>
                  <FloatingTooltip content="Split right" className="flex">
                    <Button
                      variant="unstyled"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSplit(cmd.id, 'row')}
                      className={styles['split-button']}
                      aria-label="Split right"
                    >
                      <PanelRight className={styles['split-icon']} />
                    </Button>
                  </FloatingTooltip>
                  <FloatingTooltip content="Split down" className="flex">
                    <Button
                      variant="unstyled"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSplit(cmd.id, 'column')}
                      className={styles['split-button']}
                      aria-label="Split down"
                    >
                      <PanelBottom className={styles['split-icon']} />
                    </Button>
                  </FloatingTooltip>
                </div>
              )}
            </>
          }
        >
          <Icon className={styles['row-icon']} />
          <HighlightMatch
            text={cmd.label}
            searchQuery={query}
            className={styles['command-label']}
          />
          {isViewActive && <span className={styles['active-dot']} />}
        </MenuRow>
      </Fragment>
    );
  };

  return (
    <div className={styles['list-body']} role="listbox" id={listId}>
      {mode === 'branches' ? (
        <>
          {filteredBranches.map((branch, index) => (
            <MenuRow
              key={branch}
              id={`branch-item-${index}`}
              index={index}
              isActive={index === activeIndex}
              itemRef={index === activeIndex ? activeItemRef : undefined}
              onActivate={onActivate}
              onSelect={() => onSelectBranch(branch)}
              disabled={checkoutPending}
            >
              <GitBranch className={styles['row-icon']} />
              <HighlightMatch
                text={branch}
                searchQuery={query}
                className={styles['branch-label']}
              />
              {branch === branchesData?.current_branch && <span className={styles['active-dot']} />}
            </MenuRow>
          ))}
          {filteredBranches.length === 0 && (
            <p className={styles.empty}>
              {!sandboxId
                ? 'No sandbox connected'
                : !branchesData
                  ? 'Loading branches…'
                  : !branchesData.is_git_repo
                    ? 'Not a git repository'
                    : branchesData.branches.length === 0
                      ? 'No branches in this repository'
                      : 'No matching branches'}
            </p>
          )}
        </>
      ) : mode === 'themes' ? (
        <>
          {filteredThemes.map((themeItem, index) => {
            const Icon = themeItem.icon;
            return (
              <MenuRow
                key={themeItem.value}
                id={`theme-item-${index}`}
                index={index}
                isActive={index === activeIndex}
                itemRef={index === activeIndex ? activeItemRef : undefined}
                onActivate={onActivate}
                onSelect={() => onSelectTheme(themeItem.value)}
              >
                <Icon className={styles['row-icon']} />
                <HighlightMatch
                  text={themeItem.label}
                  searchQuery={query}
                  className={styles['theme-label']}
                />
                {themeItem.value === theme && <span className={styles['active-dot']} />}
              </MenuRow>
            );
          })}
          {filteredThemes.length === 0 && <p className={styles.empty}>No matching themes</p>}
        </>
      ) : (
        <>
          {listItems.map(renderMainRow)}
          {isChatSearchPending && <p className={styles.pending}>Searching messages…</p>}
          {listItems.length === 0 && !isChatSearchPending && (
            <p className={styles.empty}>
              {mode === 'chats'
                ? 'No matching chats'
                : mode === 'files'
                  ? 'No matching files'
                  : mode === 'actions'
                    ? 'No matching actions'
                    : 'No results'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
