"use client";

// Lazy chart boundary. recharts (~100KB gz) is the one heavy client library in the app.
// These charts render below the metric strip on the Dashboard, Revenue and Cashflow pages,
// so we load recharts in an on-demand chunk (ssr:false) AFTER hydration instead of shipping
// it in each route's first-load JS. Server pages import the charts from HERE.
//
// Layout-shift note: a dynamic(ssr:false) component renders NOTHING on the server, so we
// wrap each one in a height-reserving <div>. That wrapper is an ordinary client component
// (NOT dynamic), so it DOES render in the SSR HTML — keeping the chart's box present from
// first paint. The client chart then mounts inside the already-reserved box, so nothing
// shifts. Each wrapper reserves the chart's real height (Revenue 260, InflowOutflow 230,
// Category is a fixed 240 box with no height prop).
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { RevenueChart as RevenueChartT } from "./revenue-chart";
import type { CategoryChart as CategoryChartT } from "./category-chart";
import type { InflowOutflowChart as InflowOutflowChartT } from "./inflow-outflow-chart";

const Skeleton = () => <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" />;

const RevenueChartInner = dynamic(() => import("./revenue-chart").then((m) => m.RevenueChart), { ssr: false, loading: Skeleton });
const CategoryChartInner = dynamic(() => import("./category-chart").then((m) => m.CategoryChart), { ssr: false, loading: Skeleton });
const InflowOutflowChartInner = dynamic(() => import("./inflow-outflow-chart").then((m) => m.InflowOutflowChart), { ssr: false, loading: Skeleton });

export function RevenueChart(props: ComponentProps<typeof RevenueChartT>) {
  return <div style={{ height: props.height ?? 260 }}><RevenueChartInner {...props} /></div>;
}

export function InflowOutflowChart(props: ComponentProps<typeof InflowOutflowChartT>) {
  return <div style={{ height: props.height ?? 230 }}><InflowOutflowChartInner {...props} /></div>;
}

export function CategoryChart(props: ComponentProps<typeof CategoryChartT>) {
  // CategoryChart takes no height prop — its own render is a fixed h-[240px] box.
  return <div style={{ height: 240 }}><CategoryChartInner {...props} /></div>;
}
