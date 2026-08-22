import { useEffect, useRef, useState } from 'react';

/**
 * Виміряний viewport — єдине джерело меж для вільних вікон.
 * Клітки 1024×600 більше нема; fallback лишається тільки для тестового
 * середовища без window.
 */
export function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 600,
  }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/**
 * Виміряний розмір елемента (ResizeObserver) — поверхня стола живе під
 * хромом, тож їй потрібен власний вимір, а не window.
 */
export function useElementSize<T extends HTMLElement>(): {
  ref: React.RefObject<T>;
  width: number;
  height: number;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: size.width, height: size.height };
}
