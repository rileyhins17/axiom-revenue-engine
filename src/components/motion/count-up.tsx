"use client";

import { useEffect, useRef } from "react";

/** Counts up to a number when it first renders, writing straight to the DOM. Respects reduced motion. */
export function CountUp({ value, duration = 900, className }: { value: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || value <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      node.textContent = String(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    node.textContent = "0";
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); node.textContent = String(value); };
  }, [value, duration]);
  return <span ref={ref} className={className}>{value}</span>;
}
