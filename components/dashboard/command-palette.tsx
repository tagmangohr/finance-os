"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, LayoutDashboard, TrendingUp, ArrowLeftRight, Plug, Table2, Landmark, Sheet, LineChart, Scale } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard",             label: "War Room",      Icon: LayoutDashboard, hint: "⌘1" },
  { href: "/dashboard/pnl",         label: "Profit & Loss", Icon: Sheet,           hint: "" },
  { href: "/dashboard/forecast",    label: "Forecast",      Icon: LineChart,       hint: "" },
  { href: "/dashboard/variance",    label: "Variance",      Icon: Scale,           hint: "" },
  { href: "/dashboard/revenue",     label: "Revenue",       Icon: TrendingUp,      hint: "⌘2" },
  { href: "/dashboard/cashflow",    label: "Cash Flow",     Icon: ArrowLeftRight,  hint: "⌘3" },
  { href: "/dashboard/connectors",  label: "Connectors",    Icon: Plug,            hint: "⌘6" },
  { href: "/dashboard/data",        label: "Payments",      Icon: Table2,          hint: "⌘7" },
  { href: "/dashboard/bank",        label: "Bank",          Icon: Landmark,        hint: "⌘8" },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = NAV_ITEMS.filter((n) =>
    !query || n.label.toLowerCase().includes(query.toLowerCase())
  );

  const navigate = (href: string) => {
    router.push(href);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[8px] flex items-start justify-center pt-[120px] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-[90vw] bg-card border border-border rounded-2xl overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.7)] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border">
          <Search className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && filtered[0]) navigate(filtered[0].href);
            }}
            placeholder="Search pages…"
            className="flex-1 bg-transparent border-none outline-none text-[14px] text-foreground placeholder:text-muted-foreground/70"
          />
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-accent/40 border border-border rounded text-muted-foreground">esc</kbd>
        </div>

        {/* Jump to section */}
        {filtered.length > 0 && (
          <>
            <div className="px-4 pt-2 pb-1 text-[9.5px] font-bold tracking-[0.14em] text-muted-foreground/70 uppercase">Jump to</div>
            {filtered.map((n) => (
              <button
                key={n.href}
                onClick={() => navigate(n.href)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-[12.5px] text-muted-foreground hover:bg-primary/[0.10] hover:text-white transition-all"
              >
                <n.Icon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="flex-1">{n.label}</span>
                <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-accent/40 border border-border rounded text-muted-foreground/70">{n.hint}</kbd>
              </button>
            ))}
          </>
        )}

        <div className="h-2" />
      </div>
    </div>
  );
}

/** Global hook — call once in the layout */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((p) => !p);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen, close: () => setOpen(false) };
}
