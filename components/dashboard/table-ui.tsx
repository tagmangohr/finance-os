"use client";

// Shared UI primitives for the P&L / Forecast / Variance grids so they stay in
// lock-step: the A/A/A text-size control (CSS-var driven), the opaque emphasis-row
// band classes, and an imperative (state-free) hover tooltip. The CSS var names
// (--pl/--pn/--ps/--pc) match what the P&L grid already uses, so the same Tailwind
// arbitrary classes (`text-[length:var(--pl)]` etc.) work across all three.

import * as React from "react";
import { cn } from "@/lib/utils";

export type SizeKey = "sm" | "md" | "lg";

// px sizes per preset — label, number, sub-row, secondary. Mirrors the P&L presets.
export const SIZE_PRESETS: Record<SizeKey, { label: number; num: number; sub: number; sec: number }> = {
  sm: { label: 13, num: 13, sub: 12, sec: 10 },
  md: { label: 15, num: 15, sub: 13.5, sec: 11 },   // default — comfortable
  lg: { label: 17, num: 16.5, sub: 15, sec: 12 },
};

/** Size state + localStorage persistence + the CSS-var object to spread on <table>. */
export function useTableSize(storageKey: string) {
  const [size, setSize] = React.useState<SizeKey>("md");
  React.useEffect(() => {
    try { const s = localStorage.getItem(storageKey); if (s === "sm" || s === "md" || s === "lg") setSize(s); } catch { /* private mode */ }
  }, [storageKey]);
  const changeSize = React.useCallback((s: SizeKey) => {
    setSize(s);
    try { localStorage.setItem(storageKey, s); } catch { /* ignore */ }
  }, [storageKey]);
  const sz = SIZE_PRESETS[size];
  const sizeVars = { "--pl": `${sz.label}px`, "--pn": `${sz.num}px`, "--ps": `${sz.sub}px`, "--pc": `${sz.sec}px` } as React.CSSProperties;
  return { size, changeSize, sz, sizeVars };
}

/** The A / A / A control (compact / comfortable / large). */
export function SizeControl({ size, onChange }: { size: SizeKey; onChange: (s: SizeKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden" title="Text size">
      {(["sm", "md", "lg"] as SizeKey[]).map((s, i) => (
        <button key={s} onClick={() => onChange(s)} title={`${["Compact", "Comfortable", "Large"][i]} text`}
          className={cn("h-8 w-8 font-semibold leading-none transition-colors flex items-center justify-center", size === s ? "bg-sidebar text-white" : "text-muted-foreground hover:bg-muted")}
          style={{ fontSize: [11, 13, 15][i] }}>A</button>
      ))}
    </div>
  );
}

/** Opaque emphasis-row band class (escalating), or null for a normal row. Uses the
 *  --pl-strong / --pl-cm / --pl-total tokens (defined in globals.css). */
export function emphasisBgClass(opts: { strong?: boolean; isCm?: boolean; isTotal?: boolean }): string | null {
  if (opts.isTotal) return "bg-[hsl(var(--pl-total))]";
  if (opts.isCm) return "bg-[hsl(var(--pl-cm))]";
  if (opts.strong) return "bg-[hsl(var(--pl-strong))]";
  return null;
}

/** Imperative hover tooltip — no React state, so scrolling a big grid never triggers
 *  a re-render. Spread {onMouseEnter/onMouseLeave} via show(); render <div ref={tipRef}/>. */
export function useImperativeTooltip() {
  const tipRef = React.useRef<HTMLDivElement>(null);
  const show = React.useCallback((text: string | null, x?: number, y?: number) => {
    const el = tipRef.current;
    if (!el) return;
    if (!text) { el.style.display = "none"; return; }
    el.textContent = text;
    el.style.left = `${(x ?? 0) + 12}px`;
    el.style.top = `${(y ?? 0) + 12}px`;
    el.style.display = "block";
  }, []);
  return { tipRef, show };
}
