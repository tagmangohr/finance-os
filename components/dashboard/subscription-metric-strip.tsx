"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { SlidersHorizontal, GripVertical, X, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Button } from "@/components/ui/button";
import { SUB_METRICS, SUB_METRICS_BY_KEY, SUB_VISIBLE_COUNT_OPTIONS, SUB_METRIC_GROUPS } from "@/lib/subscriptions/metric-registry";
import type { ComputedMetric } from "@/lib/metrics/types";

type Props = {
  computed: Record<string, ComputedMetric>;
  initialPinned: string[];
  initialVisibleCount: number;
  orgId: string;
};

const LS_KEY = (orgId: string) => `sub_metric_prefs_${orgId}`;

export function SubscriptionMetricStrip({ computed, initialPinned, initialVisibleCount, orgId }: Props) {
  const [pinned, setPinned] = React.useState<string[]>(initialPinned);
  const [visibleCount, setVisibleCount] = React.useState<number>(initialVisibleCount);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [draftPinned, setDraftPinned] = React.useState<string[]>(initialPinned);
  const [draftCount, setDraftCount] = React.useState<number>(initialVisibleCount);
  const dragKey = React.useRef<string | null>(null);
  const gridDrag = React.useRef<string | null>(null);
  const [overKey, setOverKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY(orgId));
      if (raw) {
        const p = JSON.parse(raw) as { pinned: string[]; visibleCount: number };
        if (Array.isArray(p.pinned) && p.pinned.length) {
          setPinned(p.pinned.filter((k) => SUB_METRICS_BY_KEY[k]));
          setVisibleCount(p.visibleCount || initialVisibleCount);
        }
      }
    } catch { /* ignore */ }
  }, [orgId, initialVisibleCount]);

  const openDrawer = () => { setDraftPinned(pinned); setDraftCount(visibleCount); setOpen(true); };
  const togglePin = (key: string) => setDraftPinned((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const move = (from: number, to: number) => setDraftPinned((cur) => {
    if (to < 0 || to >= cur.length) return cur;
    const next = [...cur]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
  });
  const onDrop = (targetKey: string) => {
    const src = dragKey.current; dragKey.current = null;
    if (!src || src === targetKey) return;
    setDraftPinned((cur) => {
      const from = cur.indexOf(src), to = cur.indexOf(targetKey);
      if (from < 0 || to < 0) return cur;
      const next = [...cur]; next.splice(from, 1); next.splice(to, 0, src); return next;
    });
  };

  const save = async () => {
    setSaving(true);
    const clean = draftPinned.filter((k) => SUB_METRICS_BY_KEY[k]);
    setPinned(clean); setVisibleCount(draftCount);
    try {
      const res = await fetch("/api/subscriptions/metric-prefs", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, pinned: clean, visibleCount: draftCount }),
      });
      const data = await res.json().catch(() => ({}));
      localStorage.setItem(LS_KEY(orgId), JSON.stringify({ pinned: clean, visibleCount: draftCount }));
      if (data?.persisted === false) toast.success("Saved on this device (apply migration 066 to sync)");
      else toast.success("Metrics updated");
      setOpen(false);
    } catch {
      localStorage.setItem(LS_KEY(orgId), JSON.stringify({ pinned: clean, visibleCount: draftCount }));
      toast.success("Saved on this device"); setOpen(false);
    } finally { setSaving(false); }
  };

  const persistPrefs = async (nextPinned: string[], nextCount: number) => {
    try { localStorage.setItem(LS_KEY(orgId), JSON.stringify({ pinned: nextPinned, visibleCount: nextCount })); } catch { /* ignore */ }
    try {
      await fetch("/api/subscriptions/metric-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ org_id: orgId, pinned: nextPinned, visibleCount: nextCount }) });
    } catch { /* keep local */ }
  };
  const reorderGrid = (targetKey: string) => {
    const src = gridDrag.current; gridDrag.current = null; setOverKey(null);
    if (!src || src === targetKey) return;
    const from = pinned.indexOf(src), to = pinned.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const next = [...pinned];
    next.splice(from, 1); next.splice(to, 0, src);
    setPinned(next); persistPrefs(next, visibleCount);
  };

  const shown = pinned.filter((k) => SUB_METRICS_BY_KEY[k]).slice(0, visibleCount);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Key metrics</h2>
        <button onClick={openDrawer} className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11.5px] font-medium text-muted-foreground hover:text-foreground border border-border hover:border-border/80 bg-card transition-colors">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Customize
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map((key) => {
          const def = SUB_METRICS_BY_KEY[key];
          const c = computed[key] ?? { value: null, display: "—", available: false };
          const isTarget = overKey === key && gridDrag.current && gridDrag.current !== key;
          return (
            <div
              key={key}
              draggable
              onDragStart={() => { gridDrag.current = key; }}
              onDragEnd={() => { gridDrag.current = null; setOverKey(null); }}
              onDragOver={(e) => { e.preventDefault(); if (overKey !== key) setOverKey(key); }}
              onDrop={() => reorderGrid(key)}
              className={`cursor-grab active:cursor-grabbing rounded-xl transition-shadow ${isTarget ? "ring-2 ring-primary/60" : ""} ${gridDrag.current === key ? "opacity-50" : ""}`}
            >
              <MetricCard title={def.label} value={c.display} subtitle={c.note ?? undefined}
                trend={c.available ? c.trend ?? undefined : undefined} trendLabel={c.trendLabel}
                icon={<def.icon className="w-4 h-4" />} accentColor={def.accent} />
            </div>
          );
        })}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-in fade-in" />
          <Dialog.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col focus:outline-none">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div>
                <Dialog.Title className="text-[15px] font-semibold text-foreground">Customize metrics</Dialog.Title>
                <Dialog.Description className="text-[12px] text-muted-foreground">Pin the subscription metrics you care about and order them.</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X className="h-4 w-4" /></button>
              </Dialog.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Show top</p>
                <div className="flex gap-1.5">
                  {SUB_VISIBLE_COUNT_OPTIONS.map((n) => (
                    <button key={n} onClick={() => setDraftCount(n)}
                      className={`h-8 min-w-[44px] px-3 rounded-lg text-[12.5px] font-medium border transition-colors ${draftCount === n ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"}`}>{n}</button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pinned — drag to reorder ({draftPinned.length})</p>
                <div className="space-y-1.5">
                  {draftPinned.length === 0 && <p className="text-[12px] text-muted-foreground italic">Nothing pinned yet — add metrics below.</p>}
                  {draftPinned.map((key, i) => {
                    const def = SUB_METRICS_BY_KEY[key]; if (!def) return null;
                    const dim = i >= draftCount;
                    return (
                      <div key={key} draggable onDragStart={() => { dragKey.current = key; }} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(key)}
                        className={`group flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 ${dim ? "opacity-45" : ""}`}>
                        <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab flex-shrink-0" />
                        <span className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${def.accent} 14%, transparent)`, color: def.accent }}><def.icon className="h-3.5 w-3.5" /></span>
                        <span className="text-[12.5px] font-medium text-foreground flex-1 truncate">{def.label}</span>
                        {dim && <span className="text-[9.5px] text-muted-foreground/60 uppercase tracking-wide">hidden</span>}
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => move(i, i - 1)} disabled={i === 0} className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30">↑</button>
                          <button onClick={() => move(i, i + 1)} disabled={i === draftPinned.length - 1} className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30">↓</button>
                          <button onClick={() => togglePin(key)} className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {SUB_METRIC_GROUPS.map((g) => {
                const items = SUB_METRICS.filter((m) => m.group === g.key);
                return (
                  <div key={g.key}>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{g.label}</p>
                    <div className="space-y-1">
                      {items.map((def) => {
                        const isPinned = draftPinned.includes(def.key);
                        return (
                          <button key={def.key} onClick={() => togglePin(def.key)}
                            className={`w-full flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${isPinned ? "border-primary/40 bg-primary/[0.05]" : "border-border hover:border-border/80 hover:bg-accent/40"}`}>
                            <span className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${def.accent} 14%, transparent)`, color: def.accent }}><def.icon className="h-3.5 w-3.5" /></span>
                            <span className="flex-1 min-w-0">
                              <span className="text-[12.5px] font-medium text-foreground truncate block">{def.label}</span>
                              <span className="block text-[11px] text-muted-foreground/70 truncate">{def.description}</span>
                            </span>
                            <span className={`h-5 w-5 rounded flex items-center justify-center flex-shrink-0 border ${isPinned ? "bg-primary border-primary text-primary-foreground" : "border-border text-transparent"}`}>
                              {isPinned ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5 text-muted-foreground/40" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2.5 px-5 py-4 border-t border-border flex-shrink-0">
              <Dialog.Close asChild><Button variant="outline" className="flex-1 border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent">Cancel</Button></Dialog.Close>
              <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
