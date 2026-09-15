"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { SlidersHorizontal, GripVertical, Eye, EyeOff, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export type CardItem = { key: string; label: string; node: React.ReactNode };

type Props = {
  /** Persistence scope, e.g. "revenue" | "payments". */
  tab: string;
  orgId: string;
  /** Full card set in DEFAULT order (keys must be stable + unique). */
  cards: CardItem[];
  /** Server-loaded prefs for instant first paint (server-rendered tabs). When
   *  OMITTED (client-rendered tabs), the component self-fetches prefs on mount. */
  initialOrder?: string[];
  initialHidden?: string[];
  /** Grid classes for the card row (e.g. "grid grid-cols-2 lg:grid-cols-5 gap-3"). */
  className?: string;
};

const LS_KEY = (orgId: string, tab: string) => `card_prefs_${orgId}_${tab}`;

// Move `src` to just before `dest` in a key list.
function moveBefore(order: string[], src: string, dest: string): string[] {
  if (src === dest) return order;
  const next = order.filter((k) => k !== src);
  const idx = next.indexOf(dest);
  if (idx < 0) return order;
  next.splice(idx, 0, src);
  return next;
}

export function CustomizableCards({ tab, orgId, cards, initialOrder, initialHidden, className }: Props) {
  const selfFetch = initialOrder === undefined; // client-rendered tab → load prefs here
  const defaultOrder = React.useMemo(() => cards.map((c) => c.key), [cards]);
  const byKey = React.useMemo(() => Object.fromEntries(cards.map((c) => [c.key, c])), [cards]);

  // Effective order = saved order (valid keys only) + any new cards appended.
  const buildOrder = React.useCallback(
    (saved: string[]) => {
      const valid = saved.filter((k) => byKey[k]);
      const missing = defaultOrder.filter((k) => !valid.includes(k));
      return [...valid, ...missing];
    },
    [byKey, defaultOrder]
  );

  const [order, setOrder] = React.useState<string[]>(() => buildOrder(initialOrder ?? []));
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set((initialHidden ?? []).filter((k) => byKey[k])));

  const applyPrefs = React.useCallback((p: { order?: unknown; hidden?: unknown }) => {
    if (Array.isArray(p.order)) setOrder(buildOrder(p.order.filter((k): k is string => typeof k === "string")));
    if (Array.isArray(p.hidden)) setHidden(new Set(p.hidden.filter((k): k is string => typeof k === "string" && !!byKey[k])));
  }, [buildOrder, byKey]);

  // Instant: apply any device-local layout (also the persistence path when the
  // prefs table isn't applied yet).
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY(orgId, tab));
      if (raw) applyPrefs(JSON.parse(raw));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tab]);

  // Client-rendered tabs (no server-passed prefs): fetch the authoritative layout.
  React.useEffect(() => {
    if (!selfFetch) return;
    const ctrl = new AbortController();
    fetch(`/api/card-prefs?org_id=${encodeURIComponent(orgId)}&tab=${encodeURIComponent(tab)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p) applyPrefs(p); })
      .catch(() => { /* keep local/default */ });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tab, selfFetch]);

  const persist = React.useCallback(
    (nextOrder: string[], nextHidden: Set<string>) => {
      const payload = { order: nextOrder, hidden: [...nextHidden] };
      try { localStorage.setItem(LS_KEY(orgId, tab), JSON.stringify(payload)); } catch { /* ignore */ }
      fetch("/api/card-prefs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, tab, ...payload }),
        keepalive: true,
      }).catch(() => { /* kept locally; syncs later */ });
    },
    [orgId, tab]
  );

  const commit = React.useCallback(
    (nextOrder: string[], nextHidden: Set<string>) => {
      setOrder(nextOrder);
      setHidden(nextHidden);
      persist(nextOrder, nextHidden);
    },
    [persist]
  );

  // ── Inline drag-to-reorder on the cards themselves ──────────────────────────
  const dragKey = React.useRef<string | null>(null);
  const [overKey, setOverKey] = React.useState<string | null>(null);

  const onCardDrop = (targetKey: string) => {
    const src = dragKey.current;
    dragKey.current = null;
    setOverKey(null);
    if (!src || src === targetKey) return;
    commit(moveBefore(order, src, targetKey), hidden);
  };

  const visibleKeys = order.filter((k) => byKey[k] && !hidden.has(k));

  // ── Customize drawer (draft state so Cancel discards) ───────────────────────
  const [open, setOpen] = React.useState(false);
  const [draftOrder, setDraftOrder] = React.useState<string[]>(order);
  const [draftHidden, setDraftHidden] = React.useState<Set<string>>(hidden);
  const drawerDrag = React.useRef<string | null>(null);

  const openDrawer = () => { setDraftOrder(order); setDraftHidden(new Set(hidden)); setOpen(true); };
  const saveDrawer = () => { commit(draftOrder, draftHidden); setOpen(false); };
  const resetDrawer = () => { setDraftOrder(defaultOrder); setDraftHidden(new Set()); };

  const toggleDraft = (key: string) =>
    setDraftHidden((cur) => {
      const next = new Set(cur);
      if (next.has(key)) { next.delete(key); return next; }
      // Never let the user hide the last visible card.
      if (draftOrder.filter((k) => !next.has(k)).length <= 1) return cur;
      next.add(key);
      return next;
    });

  const draftVisibleCount = draftOrder.filter((k) => !draftHidden.has(k)).length;

  return (
    <div className="relative">
      {/* Customize trigger */}
      <div className="flex justify-end mb-1.5">
        <button
          type="button"
          onClick={openDrawer}
          className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-medium text-muted-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Customize
        </button>
      </div>

      {/* Card grid — each card is draggable to reorder */}
      <div className={className}>
        {visibleKeys.map((key) => (
          <div
            key={key}
            draggable
            onDragStart={() => { dragKey.current = key; }}
            onDragOver={(e) => { e.preventDefault(); if (overKey !== key) setOverKey(key); }}
            onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
            onDrop={() => onCardDrop(key)}
            onDragEnd={() => { dragKey.current = null; setOverKey(null); }}
            className={cn(
              // h-full + child h-full: the wrapper is the grid item and stretches to
              // the row height, so force the card to fill it — otherwise cards with
              // less content (e.g. no "txns" line / no subtitle) render shorter.
              "h-full [&>*]:h-full cursor-grab active:cursor-grabbing rounded-xl transition-shadow",
              overKey === key && dragKey.current && dragKey.current !== key && "ring-2 ring-primary/50 ring-offset-1 ring-offset-background"
            )}
          >
            {byKey[key].node}
          </div>
        ))}
      </div>

      {/* ── Customize drawer ─────────────────────────────────────────────── */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,94vw)] max-h-[86vh] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background shadow-2xl flex flex-col focus:outline-none">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <div>
                  <Dialog.Title className="text-[14px] font-semibold text-foreground">Customize cards</Dialog.Title>
                  <Dialog.Description className="text-[11.5px] text-muted-foreground">Drag to reorder, toggle to show or hide.</Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild>
                <button className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X className="h-4 w-4" /></button>
              </Dialog.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {draftOrder.filter((k) => byKey[k]).map((key) => {
                const isHidden = draftHidden.has(key);
                const isLastVisible = !isHidden && draftVisibleCount <= 1;
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => { drawerDrag.current = key; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const src = drawerDrag.current; drawerDrag.current = null;
                      if (src) setDraftOrder((cur) => moveBefore(cur, src, key));
                    }}
                    onDragEnd={() => { drawerDrag.current = null; }}
                    className={cn(
                      "flex items-center gap-2 px-2 py-2 rounded-lg border border-transparent hover:border-border hover:bg-accent/40 transition-colors",
                      isHidden && "opacity-55"
                    )}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 cursor-grab active:cursor-grabbing flex-shrink-0" />
                    <span className="flex-1 text-[12.5px] text-foreground truncate">{byKey[key].label}</span>
                    <button
                      type="button"
                      onClick={() => toggleDraft(key)}
                      disabled={isLastVisible}
                      title={isHidden ? "Show" : isLastVisible ? "At least one card must stay visible" : "Hide"}
                      className={cn(
                        "h-7 w-7 rounded-md flex items-center justify-center transition-colors flex-shrink-0",
                        isHidden ? "text-muted-foreground/60 hover:text-foreground hover:bg-accent"
                                 : "text-primary hover:bg-primary/10",
                        isLastVisible && "opacity-40 cursor-not-allowed hover:bg-transparent"
                      )}
                    >
                      {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-border flex-shrink-0">
              <button
                onClick={resetDrawer}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
              <div className="flex items-center gap-2">
                <Dialog.Close asChild>
                  <button className="h-8 px-3 rounded-lg text-[12px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
                </Dialog.Close>
                <button onClick={saveDrawer} className="h-8 px-3.5 rounded-lg text-[12px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
