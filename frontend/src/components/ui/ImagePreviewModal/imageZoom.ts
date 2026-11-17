export type Zoom = 'fit' | number;

export interface Size {
  width: number;
  height: number;
}

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
const EPSILON = 0.001;

export function getFitScale(image: Size, stage: Size): number {
  return Math.min(1, stage.width / image.width, stage.height / image.height);
}

export function stepZoomIn(scale: number): number {
  return ZOOM_STEPS.find((step) => step > scale + EPSILON) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

export function stepZoomOut(scale: number, fitScale: number): Zoom {
  const smaller = ZOOM_STEPS.filter((step) => step < scale - EPSILON);
  const next = smaller[smaller.length - 1];
  return next === undefined || next <= fitScale + EPSILON ? 'fit' : next;
}
