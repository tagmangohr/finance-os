"use client";

import * as React from "react";

interface TickerItem {
  label: string;
  value: string;
  delta: string;
  up: boolean | null; // true=green, false=red, null=amber
}

interface TickerProps {
  cash: number;
  mrr: number;
  burnRate: number;
  runwayDays: number;
  totalOutstanding: number;
}

function fmt(n: number): string {
  if (!n) return "₹0";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${n}`;
}

export function Ticker({ cash, mrr, burnRate, runwayDays, totalOutstanding }: TickerProps) {
  const items: TickerItem[] = [
    { label: "CASH",    value: fmt(cash),             delta: "live",    up: null },
    { label: "MRR",     value: fmt(mrr),              delta: "monthly", up: null },
    { label: "BURN",    value: fmt(burnRate) + "/mo", delta: "monthly", up: null },
    { label: "RUNWAY",  value: runwayDays + "d",      delta: runwayDays < 90 ? "critical" : runwayDays < 180 ? "watch" : "healthy", up: runwayDays >= 180 ? true : runwayDays < 90 ? false : null },
    { label: "AR",      value: fmt(totalOutstanding),  delta: "outstanding", up: null },
    { label: "NET BURN", value: fmt(burnRate - mrr),  delta: burnRate > mrr ? "burning" : "positive", up: mrr >= burnRate },
  ];

  return (
    <div className="h-[30px] flex-shrink-0 overflow-hidden border-b border-border bg-accent/30 relative z-[4]">
      <div className="flex items-center gap-7 px-4 h-full animate-ticker whitespace-nowrap">
        {[...items, ...items].map((it, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11.5px]">
            <span className="text-[9.5px] font-bold tracking-[0.12em] text-muted-foreground/70 uppercase">{it.label}</span>
            <span className="num font-semibold text-foreground">{it.value}</span>
            <span
              className={[
                "text-[10.5px] px-1.5 py-px rounded font-semibold",
                it.up === true  ? "bg-success/10 text-success" :
                it.up === false ? "bg-destructive/10 text-destructive" :
                                  "bg-warning/10 text-warning",
              ].join(" ")}
            >
              {it.delta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
