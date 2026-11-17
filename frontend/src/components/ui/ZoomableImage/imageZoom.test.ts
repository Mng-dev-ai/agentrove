import { describe, expect, it } from 'vitest';
import { getFitScale, stepZoomIn, stepZoomOut } from './imageZoom';

describe('image zoom steps', () => {
  it('never upscales at fit', () => {
    expect(getFitScale({ width: 24, height: 24 }, { width: 1200, height: 800 })).toBe(1);
    expect(getFitScale({ width: 3000, height: 600 }, { width: 1200, height: 800 })).toBe(0.4);
    expect(getFitScale({ width: 600, height: 3000 }, { width: 1200, height: 750 })).toBe(0.25);
  });

  it('zooms in to the next step above the current scale and stops at the last', () => {
    expect(stepZoomIn(0.4)).toBe(0.5);
    expect(stepZoomIn(1)).toBe(1.5);
    expect(stepZoomIn(8)).toBe(8);
  });

  it('zooms out to the next step, or back to fit once it would go below fit', () => {
    expect(stepZoomOut(2, 0.4)).toBe(1.5);
    expect(stepZoomOut(0.75, 0.4)).toBe(0.5);
    expect(stepZoomOut(0.5, 0.4)).toBe('fit');
    expect(stepZoomOut(1, 1)).toBe('fit');
    expect(stepZoomOut(0.1, 0.05)).toBe('fit');
  });
});
