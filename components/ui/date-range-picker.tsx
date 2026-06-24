"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  format, parseISO, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isAfter, isBefore, isWithinInterval, isValid,
} from "date-fns";
import { cn } from "@/lib/utils";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const parse = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
};

// India financial year starts 1 April.
function fyStart(today: Date): Date {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return new Date(y, 3, 1);
}

type Preset = { label: string; range: (today: Date) => [Date, Date] };
const PRESETS: Preset[] = [
  { label: "Last 7 days",  range: (t) => [new Date(t.getTime() - 6 * 864e5), t] },
  { label: "Last 30 days", range: (t) => [new Date(t.getTime() - 29 * 864e5), t] },
  { label: "Last 90 days", range: (t) => [new Date(t.getTime() - 89 * 864e5), t] },
  { label: "This month",   range: (t) => [startOfMonth(t), t] },
  { label: "This FY",      range: (t) => [fyStart(t), t] },
  { label: "Last 1 year",  range: (t) => [new Date(t.getTime() - 364 * 864e5), t] },
];

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

interface DateRangePickerProps {
  from: string;                       // YYYY-MM-DD
  to: string;                         // YYYY-MM-DD
  onChange: (from: string, to: string) => void;
  max?: string;                       // latest selectable day (YYYY-MM-DD)
  align?: "start" | "end";
  className?: string;
}

export function DateRangePicker({ from, to, onChange, max, align = "start", className }: DateRangePickerProps) {
  const today = React.useMemo(() => new Date(), []);
  const fromD = parse(from);
  const toD = parse(to);
  const maxD = parse(max ?? null) ?? null;

  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<Date>(startOfMonth(toD ?? today));
  // While picking: holds the first clicked day until the second click closes the range.
  const [anchor, setAnchor] = React.useState<Date | null>(null);

  React.useEffect(() => { if (open) { setView(startOfMonth(toD ?? today)); setAnchor(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = React.useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(view), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(view), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [view]);

  const disabled = (d: Date) => (maxD ? isAfter(d, maxD) : false);

  function pick(d: Date) {
    if (disabled(d)) return;
    if (!anchor) {
      setAnchor(d);
      return;
    }
    // Second click: order the two and commit.
    const [a, b] = isBefore(d, anchor) ? [d, anchor] : [anchor, d];
    setAnchor(null);
    onChange(iso(a), iso(b));
    setOpen(false);
  }

  function applyPreset(p: Preset) {
    const [a, b] = p.range(today);
    onChange(iso(a), iso(b));
    setAnchor(null);
    setOpen(false);
  }

  // Effective range for highlighting (preview against the anchor while picking).
  const rangeStart = anchor ?? fromD;
  const rangeEnd = anchor ? null : toD;

  const label = fromD && toD
    ? isSameDay(fromD, toD)
      ? format(fromD, "d MMM yyyy")
      : `${format(fromD, "d MMM")} – ${format(toD, "d MMM yyyy")}`
    : "Select dates";

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-accent/40 text-[12px] text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors whitespace-nowrap",
            className
          )}
        >
          <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/70" />
          <span className="num">{label}</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-[400] flex overflow-hidden rounded-xl border border-border bg-card shadow-[0_12px_48px_rgba(0,0,0,0.6)]"
        >
          {/* Presets */}
          <div className="flex flex-col gap-0.5 p-2 border-r border-border min-w-[124px]">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="text-left text-[12px] px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-3 w-[252px]">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setView((v) => addMonths(v, -1))} className="p-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-accent">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-[12px] font-semibold text-foreground">{format(view, "MMMM yyyy")}</span>
              <button
                onClick={() => setView((v) => addMonths(v, 1))}
                disabled={maxD ? !isBefore(startOfMonth(view), startOfMonth(maxD)) : false}
                className="p-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((w, i) => (
                <span key={i} className="text-center text-[10px] font-medium text-muted-foreground/50">{w}</span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {days.map((d) => {
                const inMonth = isSameMonth(d, view);
                const isDisabled = disabled(d);
                const isStart = rangeStart && isSameDay(d, rangeStart);
                const isEnd = rangeEnd && isSameDay(d, rangeEnd);
                const inRange = rangeStart && rangeEnd && isWithinInterval(d, { start: rangeStart, end: rangeEnd });
                const selected = isStart || isEnd;
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => pick(d)}
                    disabled={isDisabled}
                    className={cn(
                      "h-7 w-7 mx-auto flex items-center justify-center text-[11.5px] rounded-md transition-colors num",
                      !inMonth && "text-muted-foreground/30",
                      inMonth && !selected && !inRange && "text-muted-foreground hover:bg-accent",
                      inRange && !selected && "bg-primary/10 text-foreground rounded-none",
                      selected && "bg-primary text-primary-foreground font-semibold",
                      isDisabled && "opacity-25 cursor-not-allowed hover:bg-transparent",
                    )}
                  >
                    {format(d, "d")}
                  </button>
                );
              })}
            </div>

            {anchor && (
              <p className="text-[10.5px] text-muted-foreground/70 mt-2 text-center">
                Start {format(anchor, "d MMM")} — pick an end date
              </p>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
