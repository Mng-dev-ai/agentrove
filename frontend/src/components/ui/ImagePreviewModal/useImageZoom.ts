import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { getFitScale, stepZoomIn, stepZoomOut, type Size, type Zoom } from './imageZoom';

const DRAG_THRESHOLD_PX = 4;
const DOUBLE_TAP_MS = 300;
const PIXELATED_FROM_SCALE = 2;

interface Point {
  x: number;
  y: number;
}

interface Anchor extends Point {
  fractionX: number;
  fractionY: number;
}

interface Drag extends Point {
  scrollLeft: number;
  scrollTop: number;
  moved: boolean;
}

function clampFraction(value: number) {
  return Math.min(1, Math.max(0, value));
}

export type ImageZoom = ReturnType<typeof useImageZoom>;

export function useImageZoom(resetKey: string, onBackgroundTap?: () => void) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [stageSize, setStageSize] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [isDragging, setIsDragging] = useState(false);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  const anchorRef = useRef<Anchor | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastTapRef = useRef(0);

  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setNatural(null);
    setZoom('fit');
  }

  useLayoutEffect(() => {
    if (!stage) return;
    const measure = () => {
      const style = getComputedStyle(stage);
      setStageSize({
        width: stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  const fitScale = natural && stageSize ? getFitScale(natural, stageSize) : 1;
  const scale = zoom === 'fit' ? fitScale : zoom;
  const isReady = natural !== null && stageSize !== null;
  const canToggle = isReady && (zoom !== 'fit' || fitScale < 1);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const image = imageRef.current;
    anchorRef.current = null;
    if (!anchor || !image || !stage) return;
    stage.scrollLeft = image.offsetLeft + anchor.fractionX * image.offsetWidth - anchor.x;
    stage.scrollTop = image.offsetTop + anchor.fractionY * image.offsetHeight - anchor.y;
  }, [scale, stage]);

  const zoomTo = (next: Zoom, point?: Point) => {
    if (!isReady || (next === 'fit' ? fitScale : next) === scale) return;
    const image = imageRef.current;
    if (stage && image) {
      const at = point ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
      const stageRect = stage.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      anchorRef.current = {
        ...at,
        fractionX: clampFraction((stageRect.left + at.x - imageRect.left) / imageRect.width),
        fractionY: clampFraction((stageRect.top + at.y - imageRect.top) / imageRect.height),
      };
    }
    setZoom(next);
  };

  const toggle = (point?: Point) => {
    if (canToggle) zoomTo(zoom === 'fit' ? 1 : 'fit', point);
  };

  const pointInStage = (e: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleTap = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target === imageRef.current) toggle(pointInStage(e));
    else if (e.target === e.currentTarget) onBackgroundTap?.();
  };

  const stageHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: e.currentTarget.scrollLeft,
        scrollTop: e.currentTarget.scrollTop,
        moved: false,
      };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);
      }
      e.currentTarget.scrollLeft = drag.scrollLeft - dx;
      e.currentTarget.scrollTop = drag.scrollTop - dy;
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse') {
        const drag = dragRef.current;
        dragRef.current = null;
        setIsDragging(false);
        if (drag && !drag.moved) handleTap(e);
        return;
      }
      if (e.target !== imageRef.current) {
        handleTap(e);
        return;
      }
      if (e.timeStamp - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        toggle(pointInStage(e));
      } else {
        lastTapRef.current = e.timeStamp;
      }
    },
    onPointerCancel: () => {
      dragRef.current = null;
      setIsDragging(false);
    },
  };

  const onImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setNatural({ width: naturalWidth, height: naturalHeight });
    }
  };

  const imageStyle: CSSProperties | undefined = natural
    ? {
        width: natural.width * scale,
        height: natural.height * scale,
        imageRendering: scale >= PIXELATED_FROM_SCALE ? 'pixelated' : undefined,
      }
    : undefined;

  return {
    stageRef: setStage,
    imageRef,
    onImageLoad,
    stageHandlers,
    imageStyle,
    natural,
    zoom,
    scale,
    isReady,
    canToggle,
    isDragging,
    zoomIn: () => zoomTo(stepZoomIn(scale)),
    zoomOut: () => zoomTo(stepZoomOut(scale, fitScale)),
    fit: () => zoomTo('fit'),
    actual: () => zoomTo(1),
    toggle: () => toggle(),
  };
}
