"use client";

import * as React from "react";
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

  return (
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
  );
}
