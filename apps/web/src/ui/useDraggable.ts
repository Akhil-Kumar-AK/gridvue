import { useRef, useState, type PointerEvent as RPE, type RefObject } from 'react';

/** Make a floating panel draggable by its header; stays inside the window. */
export function useDraggable(initial: { left: number; top: number }, box: RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ sx: number; sy: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: RPE) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, textarea, [role=tab]')) return;
    drag.current = { sx: e.clientX, sy: e.clientY, left: pos.left, top: pos.top };
    const move = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return;
      const w = box.current?.offsetWidth ?? 300, h = box.current?.offsetHeight ?? 400;
      setPos({ left: Math.min(window.innerWidth - w - 8, Math.max(8, d.left + ev.clientX - d.sx)), top: Math.min(window.innerHeight - h - 8, Math.max(8, d.top + ev.clientY - d.sy)) });
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    e.preventDefault();
  };
  return { pos, setPos, onPointerDown };
}
