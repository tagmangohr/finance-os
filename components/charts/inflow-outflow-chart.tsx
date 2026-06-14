"use client";

import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, type TooltipProps,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface Props {
  data: { label: string; inflow: number; outflow: number }[];
  height?: number;
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl min-w-[150px]">
      <p className="text-muted-foreground text-[10.5px] font-bold tracking-[0.1em] uppercase mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey as string} className="flex justify-between gap-4 mb-0.5 last:mb-0">
          <span className="text-[11px] capitalize" style={{ color: p.color as string }}>{p.dataKey as string}</span>
          <span className="num text-[11px] font-semibold text-popover-foreground">
            {formatCurrency((p.value as number) ?? 0, "INR", true)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function InflowOutflowChart({ data, height = 230 }: Props) {
  if (!data?.length) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
        No cash-flow data available
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={3} barCategoryGap="26%">
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)", radius: 4 }} />
        <Bar dataKey="inflow" radius={[3, 3, 0, 0]} fill="hsl(var(--metric-revenue))" />
        <Bar dataKey="outflow" radius={[3, 3, 0, 0]} fill="hsl(var(--metric-runway))" />
      </BarChart>
    </ResponsiveContainer>
  );
}
