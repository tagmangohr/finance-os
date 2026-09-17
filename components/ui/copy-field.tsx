"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared copyable value pill. Replaces the near-identical Copyable/CopyField helpers
 * that lived in settings-client and users-client.
 */
export function CopyField({ value, className, mono = true }: { value: string; className?: string; mono?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <code className={cn("flex-1 min-w-0 break-all rounded-lg bg-muted/50 border border-border px-2.5 py-1.5 text-[11.5px] text-foreground select-all", mono && "font-mono")}>
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="p-1.5 rounded-lg border border-border hover:bg-muted flex-shrink-0 transition-colors"
        title="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
    </div>
  );
}
