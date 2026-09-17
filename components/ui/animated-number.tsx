"use client";

import * as React from "react";
import { formatCurrency } from "@/lib/utils";
import type { MetricFormat } from "@/lib/metrics/types";

// One place to tune the "tallying up" feel. Ease-out so most of the motion
// happens up front and the number gently settles onto its final value.
const DURATION_MS = 1500;
const easeOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

// useLayoutEffect on the client (so we can set the start value BEFORE the first
// paint and avoid flashing the final number), plain effect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function useReducedMotion(): boolean {
  // Lazy init from matchMedia so a reduced-motion user never sees a frame of
  // animation before an effect corrects it. (SSR → false; the rendered text is
  // the final value regardless, so this never causes a hydration mismatch.)
  const [reduced, setReduced] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? prefersReducedMotion() : false
  );
  React.useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return; }
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * Format one intermediate frame of a counting number. Mirrors the metric
 * registry's own helpers (lib/metrics/registry.ts) so the frames look native;
 * the FINAL frame always uses the exact `display` string passed in, so the
 * animation can never land on a value that differs from what the app shows
 * statically. Currency re-runs formatCurrency each frame so the ₹ / Cr / L / K
 * scale is correct all the way up (0 → ₹1.2L → ₹3.82Cr).
 */
export function formatMetricFrame(v: number, format: MetricFormat, display: string): string {
  const d = display.trim();
  switch (format) {
    case "currency":
    case "currencyPerMonth": {
      // Format the magnitude, then prefix the sign to match the app's display
      // convention (-₹/+₹/₹) — formatCurrency's compact branch would otherwise
      // put the minus AFTER the ₹ ("₹-1.20L") and never render a leading "+".
      const abs = formatCurrency(Math.abs(v), "INR", true);
      const sign = v < 0 ? "-" : d.startsWith("+") ? "+" : "";
      const perMo = d.endsWith("/mo") ? "/mo" : "";
      return `${sign}${abs}${perMo}`;
    }
    case "percent": {
      // Match the display's decimal precision (e.g. YoY shows "12%", not "12.0%")
      // so no phantom decimal appears mid-count, and keep the sign convention.
      const decimals = d.includes(".") ? (d.split(".")[1].match(/\d+/)?.[0].length ?? 1) : 0;
      const sign = d.startsWith("+") && v >= 0 ? "+" : v < 0 ? "-" : "";
      return `${sign}${Math.abs(v).toFixed(decimals)}%`;
    }
    case "duration":
      return display; // runway / "∞" — not sensibly countable
    case "number":
    default:
      return Math.round(v).toLocaleString("en-IN");
  }
}

/**
 * Best-effort format inference from a final display string, for call sites that
 * don't carry a MetricFormat (e.g. the subscription strip). Returns null for
 * anything ambiguous (ratios like "1.8×", "∞", em-dash) so those render
 * statically rather than animating incorrectly.
 */
export function inferMetricFormat(display: string): MetricFormat | null {
  const s = display.trim();
  if (!s || s === "—" || s === "∞") return null;
  if (s.endsWith("%")) return "percent";
  if (/[₹$€£]/.test(s)) return "currency";
  if (/^[+-]?\d+$/.test(s.replace(/,/g, ""))) return "number"; // integers (with Indian grouping)
  return null;
}

export interface AnimatedNumberProps {
  /** The target numeric value. Non-finite values (Infinity/NaN) render statically. */
  value: number;
  /** How to format each frame (matches the metric's MetricFormat). Default "number". */
  format?: MetricFormat;
  /** The exact final string to land on. Defaults to the formatted value. Pass the
   *  app's own display string (e.g. MetricCard's `value`) to guarantee a match. */
  display?: string;
  /** Disable animation for this instance (renders the final value statically). */
  disabled?: boolean;
  className?: string;
}

/**
 * A number that counts up to its value with an ease-out "tallying" animation,
 * then settles on the exact `display` string. Animates on mount (0 → value) and
 * again whenever `value` genuinely changes (prev → next) — not on unrelated
 * re-renders. SSR-safe and honours prefers-reduced-motion.
 */
export function AnimatedNumber({ value, format = "number", display, disabled, className }: AnimatedNumberProps) {
  const reduced = useReducedMotion();
  const final = display ?? formatMetricFrame(value, format, "");
  const animatable = !disabled && Number.isFinite(value) && format !== "duration";

  // Last value we settled ON, so a change animates prev → next (mount: 0 → value).
  const fromRef = React.useRef<number | null>(null);
  // Latest value actually on screen (updated every frame) so a value change that
  // interrupts an in-flight animation resumes from what's visible, not from 0.
  const liveRef = React.useRef<number | null>(null);
  // SSR + first client render = the final value (hydration-safe).
  const [text, setText] = React.useState(final);

  useIsoLayoutEffect(() => {
    if (!animatable || reduced) {
      setText(final);
      fromRef.current = value;
      liveRef.current = value;
      return;
    }
    const from = liveRef.current ?? fromRef.current ?? 0;
    const to = value;
    if (from === to) { setText(final); return; }

    let raf = 0;
    const start = performance.now();
    // Set the start value before paint so the final number never flashes.
    liveRef.current = from;
    setText(formatMetricFrame(from, format, final));
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      if (t >= 1) {
        setText(final);            // land on the exact app-provided string
        fromRef.current = to;
        liveRef.current = to;
        return;
      }
      const cur = from + (to - from) * easeOut(t);
      liveRef.current = cur;
      setText(formatMetricFrame(cur, format, final));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, final, animatable, reduced, format]);

  return <span className={className}>{text}</span>;
}
