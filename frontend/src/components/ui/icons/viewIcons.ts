import { createLucideIcon } from 'lucide-react';

export const DiffIcon = createLucideIcon('view-diff', [
  ['path', { d: 'M12 6v8', key: 'plus-v' }],
  ['path', { d: 'M8 10h8', key: 'plus-h' }],
  ['path', { d: 'M8 18h8', key: 'minus' }],
]);

export const EditorIcon = createLucideIcon('view-editor', [
  ['path', { d: 'm8 8-4 4 4 4', key: 'left' }],
  ['path', { d: 'm16 8 4 4-4 4', key: 'right' }],
  ['path', { d: 'm13.5 6-3 12', key: 'slash' }],
]);

export const TerminalIcon = createLucideIcon('view-terminal', [
  ['path', { d: 'm5 7 5 5-5 5', key: 'prompt' }],
  ['path', { d: 'M13 17h6', key: 'cursor' }],
]);

export const SessionPanelIcon = createLucideIcon('session-panel', [
  ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2', key: 'frame' }],
  ['path', { d: 'M15 5v14', key: 'rail' }],
]);
