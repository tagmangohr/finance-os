import { ArrowUpRight, ArrowDownRight, Repeat } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { MrrMovement } from "@/lib/subscriptions/mrr-movement";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1] ?? ""} ${y ?? ""}`.trim();
}
const inr = (n: number) => formatCurrency(Math.abs(n), "INR", true);

/**
 * Dashboard MRR Movement panel — how recurring revenue moved this month: New (+) and
 * Churned (−) MRR from subscriptions, their Net, and a comparison to last month's net.
 * Shows the DELTA only (not an absolute MRR) so it complements, not contradicts, the
 * headline MRR metric card, which uses a different MRR definition.
 */
export function MrrMovementPanel({ data }: { data: MrrMovement }) {
  const positive = data.netMrr >= 0;
  const improved = data.netMrr >= data.lastMonthNet;

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[13px] font-semibold text-foreground">MRR Movement</p>
          <p className="text-[11px] text-muted-foreground">{monthLabel(data.month)}</p>
        </div>
        <span className="h-7 w-7 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
          <Repeat className="h-3.5 w-3.5" />
        </span>
      </div>

      {!data.hasData ? (
        <div className="flex-1 flex items-center justify-center min-h-[120px]">
          <p className="text-[12px] text-muted-foreground">No subscription data yet</p>
        </div>
      ) : (
        <>
          {/* Net change — the headline of the panel */}
          <div className="mb-3">
            <p className="text-[11px] text-muted-foreground mb-0.5">Net change</p>
            <p className={`num text-[24px] font-bold leading-none ${positive ? "text-success" : "text-destructive"}`}>
              {positive ? "+" : "−"}{inr(data.netMrr)}
            </p>
          </div>

          {/* New + Churned breakdown */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0 bg-success/10 text-success">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
              <span className="text-[12px] text-muted-foreground flex-1">New</span>
              <span className="num text-[12.5px] font-semibold text-success">+{inr(data.newMrr)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0 bg-destructive/10 text-destructive">
                <ArrowDownRight className="h-3.5 w-3.5" />
              </span>
              <span className="text-[12px] text-muted-foreground flex-1">Churned</span>
              <span className="num text-[12.5px] font-semibold text-destructive">−{inr(data.churnedMrr)}</span>
            </div>
          </div>

          {/* vs last month */}
          <div className="mt-3 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
            Last month net{" "}
            <span className={data.lastMonthNet >= 0 ? "text-success" : "text-destructive"}>
              {data.lastMonthNet >= 0 ? "+" : "−"}{inr(data.lastMonthNet)}
            </span>
            {" · "}
            <span className={improved ? "text-success" : "text-destructive"}>{improved ? "improving" : "slowing"}</span>
          </div>
        </>
      )}
    </div>
  );
}
