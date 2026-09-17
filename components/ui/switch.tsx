"use client";

import { cn } from "@/lib/utils";

/**
 * Shared pill switch. Replaces the several hand-rolled copies that lived in
 * settings-client / users-client. Theme-aware, accessible (role="switch").
 */
export function Switch({
  checked,
  onChange,
  disabled,
  size = "md",
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
}) {
  const dims = size === "sm"
    ? { track: "h-4 w-7", knob: "h-3 w-3", on: "translate-x-[13px]", off: "translate-x-0.5" }
    : { track: "h-5 w-9", knob: "h-4 w-4", on: "translate-x-[18px]", off: "translate-x-0.5" };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex flex-shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 disabled:cursor-not-allowed",
        dims.track,
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block transform rounded-full bg-white shadow-sm transition-transform",
          dims.knob,
          checked ? dims.on : dims.off,
        )}
      />
    </button>
  );
}
