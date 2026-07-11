// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingTooltip } from './FloatingTooltip';

const TOOLTIP_HEIGHT = 30;
const TOOLTIP_WIDTH = 100;

function showTooltip(rect: Pick<DOMRect, 'bottom' | 'left' | 'top'>) {
  render(
    <FloatingTooltip content="Tooltip content">
      <span>Trigger</span>
    </FloatingTooltip>,
  );
  const trigger = screen.getByText('Trigger').parentElement;
  if (trigger == null) throw new Error('Tooltip trigger was not rendered');

  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  vi.spyOn(trigger, 'matches').mockImplementation((selector) => selector === ':hover');
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
  act(() => {
    vi.advanceTimersByTime(500);
  });

  return screen.getByRole('tooltip');
}

describe('FloatingTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(TOOLTIP_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(TOOLTIP_WIDTH);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(500);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(300);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flips above a trigger when the tooltip would cross the bottom edge', () => {
    const tooltip = showTooltip({ top: 470, bottom: 490, left: 20 });

    expect(tooltip.style.top).toBe('436px');
    expect(tooltip.style.left).toBe('20px');
  });

  it('shifts left when the tooltip would cross the right edge', () => {
    const tooltip = showTooltip({ top: 100, bottom: 120, left: 280 });

    expect(tooltip.style.top).toBe('124px');
    expect(tooltip.style.left).toBe('192px');
  });
});
