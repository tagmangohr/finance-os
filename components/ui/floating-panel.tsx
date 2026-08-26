"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X, GripVertical } from "lucide-react";

/**
 * A draggable, resizable floating panel — a non-modal alternative to a slide-in
 * drawer. It has NO backdrop, so the page behind it stays fully visible and
 * interactive: drag it aside by the header and keep reading the table underneath.
 * Rendered through a portal so it floats above everything and is never clipped.
 *
 * Drag: press the header. Resize: the bottom-right grip. Esc or the ✕ closes it.
 * Position/size persist while open and re-anchor to the top-right on reopen.
 */
export function FloatingPanel({
  open, onClose, title, subtitle, headerRight, children,
  width = 460, height = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  height?: number;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = React.useState({ w: width, h: height });
  // Active interaction (drag/resize) — window listeners read/update this.
  const act = React.useRef<null | { mode: "drag" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }>(null);

  React.useEffect(() => setMounted(true), []);

  // Anchor to the top-right when opened (clamped to the viewport).
  React.useEffect(() => {
    if (!open) return;
    const w = Math.min(width, window.innerWidth - 32);
    const h = Math.min(height, window.innerHeight - 120);
    setSize({ w, h });
    setPos({ x: Math.max(16, window.innerWidth - w - 28), y: 92 });
  }, [open, width, height]);

  // Esc closes.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Global move/up listeners live for the whole open lifetime; they no-op unless a
  // drag/resize is active (set on pointerdown). Simpler + more robust than add/remove.
  React.useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      const a = act.current;
      if (!a) return;
      e.preventDefault();
      if (a.mode === "drag") {
        const x = a.ox + (e.clientX - a.sx);
        const y = a.oy + (e.clientY - a.sy);
        const maxX = window.innerWidth - 60, maxY = window.innerHeight - 44;
        setPos({ x: Math.min(Math.max(-size.w + 120, x), maxX), y: Math.min(Math.max(0, y), maxY) });
      } else {
        const w = Math.min(Math.max(320, a.ow + (e.clientX - a.sx)), window.innerWidth - 16);
        const h = Math.min(Math.max(240, a.oh + (e.clientY - a.sy)), window.innerHeight - 16);
        setSize({ w, h });
      }
    };
    const onUp = () => { act.current = null; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [open, size.w]);

  if (!mounted || !open || !pos) return null;

  const startDrag = (e: React.PointerEvent) => {
    act.current = { mode: "drag", sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, ow: size.w, oh: size.h };
    document.body.style.userSelect = "none";
  };
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    act.current = { mode: "resize", sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, ow: size.w, oh: size.h };
    document.body.style.userSelect = "none";
  };

  return createPortal(
    <div
      role="dialog"
      aria-label={title}
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 200 }}
      className="flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden ring-1 ring-black/5"
    >
      <div
        onPointerDown={startDrag}
        className="flex items-start justify-between gap-3 px-3.5 py-2.5 border-b border-border bg-muted/60 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-start gap-2 min-w-0">
          <GripVertical className="h-4 w-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground truncate">{title}</p>
            {subtitle && <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {headerRight}
          <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>

      {/* resize grip */}
      <div
        onPointerDown={startResize}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        style={{ background: "linear-gradient(135deg, transparent 50%, hsl(var(--muted-foreground) / 0.35) 50%)" }}
        title="Drag to resize"
      />
    </div>,
    document.body
  );
}
