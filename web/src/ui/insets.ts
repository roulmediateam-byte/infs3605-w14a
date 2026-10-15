// Sticky and fixed bars report their height as a CSS variable (--inset-top, --inset-pinned, --inset-bottom,
// --inset-save), and the page's scroll padding uses them, so a control that takes focus is scrolled clear of the bars
// rather than hidden behind them (WCAG 2.4.11; UI brief: "never hidden behind a sticky bar"). See styles.css, html.
import { useCallback, useEffect, useRef } from 'react';

export type InsetName = 'top' | 'pinned' | 'bottom' | 'save';

/** A callback ref for a bar: while the bar is on screen, its height is kept in --inset-<name> on the root element. */
export const useInsetRef = (name: InsetName) => {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback(
    (element: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!element) return;
      const root = document.documentElement;
      const property = `--inset-${name}`;
      const measure = () => root.style.setProperty(property, `${Math.ceil(element.getBoundingClientRect().height)}px`);
      measure();
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      observer?.observe(element);
      cleanup.current = () => {
        observer?.disconnect();
        root.style.removeProperty(property);
      };
    },
    [name],
  );
};
