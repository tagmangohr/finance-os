"use client";

// Lazy chart boundary. recharts (~100KB gz) is the one heavy client library in the app.
// These three charts render below the metric strip on the Dashboard, Revenue and Cashflow
// pages, so we load recharts in an on-demand chunk (ssr:false) AFTER hydration instead of
// shipping it in each route's first-load JS. Server pages import the charts from HERE
// rather than from the individual chart files. A fixed-height skeleton (rendered in the
// SSR HTML) reserves the space so deferring the chart causes no layout shift.
import dynamic from "next/dynamic";

const Skeleton = ({ h = 260 }: { h?: number }) => (
  <div className="w-full animate-pulse rounded-lg bg-muted/30" style={{ height: h }} />
);

export const RevenueChart = dynamic(
  () => import("./revenue-chart").then((m) => m.RevenueChart),
  { ssr: false, loading: () => <Skeleton /> }
);

export const CategoryChart = dynamic(
  () => import("./category-chart").then((m) => m.CategoryChart),
  { ssr: false, loading: () => <Skeleton /> }
);

export const InflowOutflowChart = dynamic(
  () => import("./inflow-outflow-chart").then((m) => m.InflowOutflowChart),
  { ssr: false, loading: () => <Skeleton /> }
);
