// TS mirror of src/styles/globals/_state-classes.scss — keep the two in sync.
// Usage: clsx(styles['chat-row'], isSelected && stateClasses.SELECTED)
export const stateClasses = {
  HOVER: 'is-hover',
  ACTIVE: 'is-active',
  SELECTED: 'is-selected',
  OPEN: 'is-open',
  CLOSED: 'is-closed',
  HIDDEN: 'is-hidden',
  VISIBLE: 'is-visible',
  DISABLED: 'is-disabled',
  LOADING: 'is-loading',
  STREAMING: 'is-streaming',
  ERROR: 'is-error',
  FOCUSED: 'is-focused',
  DRAGGING: 'is-dragging',
  DRAG_OVER: 'is-drag-over',
  COLLAPSED: 'is-collapsed',
  EXPANDED: 'is-expanded',
  PENDING: 'is-pending',
  CURRENT: 'is-current',
  COMPACT: 'is-compact',
} as const;

export type StateClass = (typeof stateClasses)[keyof typeof stateClasses];
