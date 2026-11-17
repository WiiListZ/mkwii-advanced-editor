// A scrolling list of any length whose rows all have one height: only the rows in sight, and a few
// around them, are drawn. Used where the game has thousands of entries (sounds, game text).
import * as React from "react";

export function VirtualRows<T>({ items, rowHeight, row, resetKey, overscan = 8, className = "min-h-0 flex-1 overflow-y-auto p-1" }: {
  items: T[]; rowHeight: number; row: (item: T, index: number) => React.ReactNode; resetKey?: unknown; overscan?: number; className?: string;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ top: 0, height: 600 });
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A new search starts at the top of its results.
  React.useEffect(() => { if (box.current) { box.current.scrollTop = 0; setView((v) => ({ ...v, top: 0 })); } }, [resetKey]);
  const first = Math.max(0, Math.floor(view.top / rowHeight) - overscan), last = Math.min(items.length, Math.ceil((view.top + view.height) / rowHeight) + overscan);
  return <div ref={box} className={className} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
    <div className="relative" style={{ height: items.length * rowHeight }}>
      <div className="absolute inset-x-0" style={{ top: first * rowHeight }}>{items.slice(first, last).map((item, i) => row(item, first + i))}</div>
    </div>
  </div>;
}
