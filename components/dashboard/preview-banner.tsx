import Link from "next/link";
import { Sparkles, Zap } from "lucide-react";

/** Shown on a tab when it's rendering sample data (no source connected yet). */
export function PreviewBanner() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5 animate-enter">
      <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
      <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0">
        <span className="font-semibold text-foreground">Preview — sample data.</span>{" "}
        Connect a source to replace this with your real numbers.
      </p>
      <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0">
        <Zap className="h-3.5 w-3.5" /> Connect
      </Link>
    </div>
  );
}
