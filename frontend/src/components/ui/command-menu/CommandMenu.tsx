import { useRef } from 'react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '../primitives/Button/Button';
import { useModalLayer } from '../shared/BaseModal/useModalLayer';
import { SearchPanel } from '@/components/editor/file-search/SearchPanel';
import { ChatSearchPanel } from '@/components/chat/chat-search/ChatSearchPanel';
import { CommandMenuInput } from './CommandMenuInput';
import { CommandMenuList } from './CommandMenuList';
import { useCommandMenu } from './useCommandMenu';
import { FILTER_LABELS, isMainMode, isPanelMode } from './commandMenuModes';
import { FILTER_SHORTCUTS, MAIN_FILTERS, formatShortcut } from './commandRegistry';
import styles from './CommandMenu.module.scss';

export function CommandMenu() {
  const {
    isOpen,
    close,
    mode,
    switchMode,
    switchFilter,
    query,
    setQuery,
    setActiveIndex,
    activeIndex,
    inputRef,
    searchInputRef,
    chatSearchInputRef,
    activeItemRef,
    listId,
    activeDescendant,
    activateFromMouse,
    trimmedQuery,
    isMobile,
    listItems,
    leafTileIds,
    activeSlot,
    handleOpenChatResult,
    handleOpenChannel,
    handleSelectFile,
    runCommand,
    handleSplit,
    filteredBranches,
    branchesData,
    sandboxId,
    worktreeCwd,
    checkoutBranch,
    handleSelectBranch,
    filteredThemes,
    theme,
    handleSelectTheme,
    handleOpenSearchResult,
    modKey,
  } = useCommandMenu();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalLayer(dialogRef, isOpen, close);

  if (!isOpen) return null;

  // Phones have no Escape key and the sheet covers the overlay.
  const closeButton = isMobile && (
    <Button variant="unstyled" onClick={close} aria-label="Close" className={styles.close}>
      <X className={styles['close-icon']} />
    </Button>
  );

  return createPortal(
    <div
      className={styles.overlay}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command menu"
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        // Focusable so a click on dead space keeps focus (and Escape) inside the menu.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Page shortcuts must not see palette typing; Escape and Tab go on to the modal layer.
          if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
        }}
      >
        {/* Panel tabs (Messages/Grep) embed panels that own their inputs, so the
            shared query input is hidden there and the tab row leads the dialog. */}
        {!isPanelMode(mode) && (
          <CommandMenuInput
            mode={mode}
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              setActiveIndex(0);
            }}
            inputRef={inputRef}
            onBack={() => switchMode('all')}
            listId={listId}
            activeDescendant={activeDescendant}
            trailing={closeButton}
          />
        )}

        {isMainMode(mode) && (
          <div className={styles.filters}>
            {MAIN_FILTERS.map((filter) => (
              <Button
                key={filter}
                variant="unstyled"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => switchFilter(filter)}
                className={clsx(styles.filter, filter === mode && styles['filter--active'])}
                title={filter === 'all' ? undefined : formatShortcut(FILTER_SHORTCUTS[filter])}
              >
                {FILTER_LABELS[filter]}
              </Button>
            ))}
            {isPanelMode(mode) && closeButton}
          </div>
        )}

        {mode === 'grep' ? (
          <div className={styles.panel}>
            <SearchPanel
              sandboxId={sandboxId ?? undefined}
              cwd={worktreeCwd}
              onOpenResult={handleOpenSearchResult}
              inputRef={searchInputRef}
            />
          </div>
        ) : mode === 'messages' ? (
          <div className={styles.panel}>
            <ChatSearchPanel
              onOpenChat={handleOpenChatResult}
              onOpenChannel={handleOpenChannel}
              inputRef={chatSearchInputRef}
            />
          </div>
        ) : (
          <CommandMenuList
            mode={mode}
            listId={listId}
            activeIndex={activeIndex}
            activeItemRef={activeItemRef}
            onActivate={activateFromMouse}
            query={query}
            trimmedQuery={trimmedQuery}
            isMobile={isMobile}
            listItems={listItems}
            leafTileIds={leafTileIds}
            activeSlot={activeSlot}
            onOpenChat={handleOpenChatResult}
            onOpenChannel={handleOpenChannel}
            onSelectFile={handleSelectFile}
            onRunCommand={runCommand}
            onSplit={handleSplit}
            filteredBranches={filteredBranches}
            branchesData={branchesData}
            sandboxId={sandboxId}
            checkoutPending={checkoutBranch.isPending}
            onSelectBranch={handleSelectBranch}
            filteredThemes={filteredThemes}
            theme={theme}
            onSelectTheme={handleSelectTheme}
          />
        )}

        {!isMobile && (
          <div className={styles.footer}>
            <span className={styles['footer-hint']}>
              {mode === 'branches'
                ? '↵ Switch branch · Esc to close'
                : mode === 'themes'
                  ? '↵ Set theme · Esc to close'
                  : isPanelMode(mode)
                    ? `${modKey}[ or ${modKey}] change filter · Esc to close`
                    : `↑↓ Select · ↵ Open · ${modKey}[ or ${modKey}] change filter · Esc to close`}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
