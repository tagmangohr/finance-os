"use client";

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, type TooltipProps,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface Props {
  data: { label: string; inflow: number; outflow: number }[];
  height?: number;
}

type Row = { label: string; inflow: number; outflow: number; net: number };

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  const netPos = row.net >= 0;
  return (
    <div className="rounded-xl border border-border bg-popover/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl min-w-[160px]">
      <p className="text-muted-foreground text-[10.5px] font-bold tracking-[0.1em] uppercase mb-1.5">{label}</p>
      <div className="flex justify-between gap-4 mb-0.5">
        <span className="text-[11px]" style={{ color: "hsl(var(--primary))" }}>Inflow</span>
        <span className="num text-[11px] font-semibold text-popover-foreground">{formatCurrency(row.inflow, "INR", true)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-[11px]" style={{ color: "hsl(var(--warning))" }}>Outflow</span>
        <span className="num text-[11px] font-semibold text-popover-foreground">{formatCurrency(row.outflow, "INR", true)}</span>
      </div>
      <div className="flex justify-between gap-4 pt-1 mt-1 border-t border-border/50">
        <span className="text-[11px] font-medium text-muted-foreground">Net</span>
        <span className={`num text-[11px] font-bold ${netPos ? "text-success" : "text-destructive"}`}>
          {netPos ? "+" : "−"}{formatCurrency(Math.abs(row.net), "INR", true)}
        </span>
      </div>
    </div>
  );
}

const fmtAxis = (v: number) => formatCurrency(v, "INR", true);

export function InflowOutflowChart({ data, height = 230 }: Props) {
  if (!data?.length) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
        No cash-flow data available
      </div>
    );
  }
  // Net = inflow − outflow per month. The line makes surplus/deficit legible at a glance;
  // the zero reference line marks where a month tips from cash-positive to cash-negative.
  const rows: Row[] = data.map((d) => ({ ...d, net: d.inflow - d.outflow }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={3} barCategoryGap="26%">
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} strokeDasharray="2 4" />
        <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={8} />
        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={48} tickFormatter={fmtAxis} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)", radius: 4 }} />
        <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
        <Bar dataKey="inflow" radius={[3, 3, 0, 0]} fill="hsl(var(--primary))" />
        <Bar dataKey="outflow" radius={[3, 3, 0, 0]} fill="hsl(var(--warning))" />
        <Line type="monotone" dataKey="net" stroke="hsl(var(--foreground))" strokeWidth={2}
          dot={{ r: 2.5, fill: "hsl(var(--foreground))", strokeWidth: 0 }} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
