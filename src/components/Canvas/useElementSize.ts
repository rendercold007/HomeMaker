import { useEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Track an element's pixel size via ResizeObserver. Returns a ref to attach and
 * the current size. The Konva Stage needs explicit pixel dimensions, so we feed
 * it from here rather than CSS.
 */
export function useElementSize<T extends HTMLElement>(): [
  React.RefObject<T>,
  Size,
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
