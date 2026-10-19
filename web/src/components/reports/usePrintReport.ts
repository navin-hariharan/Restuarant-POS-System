import { useCallback, useEffect, useRef, useState } from 'react';
import { printElement } from './export';

/**
 * Print a report area. While `printing` is true, tables should render every row
 * (pass it to `<LocalTable printAll>`); the element is printed on the next frame.
 */
export function usePrintReport(title: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => {
      printElement(ref.current, title);
      setPrinting(false);
    });
    return () => cancelAnimationFrame(id);
  }, [printing, title]);
  const print = useCallback(() => setPrinting(true), []);
  return { ref, printing, print };
}
