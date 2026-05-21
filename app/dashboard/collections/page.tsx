export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Send, AlertCircle } from "lucide-react";
import { getOrgId, getCollectionsData } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function CollectionsPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const { overdueInvoices, debtors, aging, totalOutstanding, collectionRate } =
    await getCollectionsData(orgId);

  const agingBars = [
    { label: "0-30 days", amount: aging.overdue030, color: "bg-amber-400", variant: "warning" as const },
    { label: "31-60 days", amount: aging.overdue3160, color: "bg-orange-500", variant: "warning" as const },
    { label: "61-90 days", amount: aging.overdue6190, color: "bg-red-500", variant: "destructive" as const },
    { label: "90+ days", amount: aging.overdue90plus, color: "bg-red-700", variant: "destructive" as const },
  ];
  const maxAgingAmount = Math.max(...agingBars.map((b) => b.amount), 1);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Collections</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track outstanding receivables and follow up with customers
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Outstanding"
          value={formatCurrency(totalOutstanding, "INR", true)}
          subtitle="All receivables"
          severity={totalOutstanding > 0 ? "warning" : "good"}
          icon={<FileText className="h-5 w-5" />}
        />
        <MetricCard
          title="0-30 Days"
          value={formatCurrency(aging.overdue030, "INR", true)}
          subtitle="Recently overdue"
          severity={aging.overdue030 > 0 ? "warning" : "good"}
        />
        <MetricCard
          title="31-60 Days"
          value={formatCurrency(aging.overdue3160, "INR", true)}
          subtitle="Needs follow-up"
          severity={aging.overdue3160 > 0 ? "warning" : "good"}
        />
        <MetricCard
          title="61-90 Days"
          value={formatCurrency(aging.overdue6190, "INR", true)}
          subtitle="Escalate now"
          severity={aging.overdue6190 > 0 ? "critical" : "good"}
        />
        <MetricCard
          title="90+ Days"
          value={formatCurrency(aging.overdue90plus, "INR", true)}
          subtitle="Serious default risk"
          severity={aging.overdue90plus > 0 ? "critical" : "good"}
        />
      </div>

      {/* Debtors table + Aging chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Debtors table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>Outstanding Debtors</CardTitle>
          </CardHeader>
          <CardContent>
            {debtors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No outstanding receivables. Great work!</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-muted-foreground font-medium">Entity</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Outstanding</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Avg Days</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Last Invoice</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {debtors.map((debtor) => {
                      const avgDays = debtor.avg_payment_days ?? 0;
                      const overdueSeverity = avgDays > 90 ? "destructive" : avgDays > 30 ? "warning" : "secondary";
                      return (
                        <tr key={debtor.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3">
                            <div>
                              <p className="font-medium text-foreground">{debtor.name}</p>
                              {debtor.email && (
                                <p className="text-xs text-muted-foreground">{debtor.email}</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 text-right tabular-nums font-semibold text-foreground">
                            {formatCurrency(debtor.outstanding_amount, "INR", true)}
                          </td>
                          <td className="py-3 text-right">
                            {avgDays > 0 ? (
                              <Badge variant={overdueSeverity}>
                                {Math.round(avgDays)}d
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 text-right text-muted-foreground">
                            {debtor.last_transaction_date
                              ? formatDate(debtor.last_transaction_date)
                              : "—"}
                          </td>
                          <td className="py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              asChild
                            >
                              <Link
                                href={`/dashboard/intelligence?ask=Send reminder to ${encodeURIComponent(debtor.name)}`}
                              >
                                <Send className="h-3 w-3" />
                                Remind
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Aging breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Overdue Aging</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {agingBars.map((bar) => (
                <div key={bar.label}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-muted-foreground">{bar.label}</span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(bar.amount, "INR", true)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${bar.color}`}
                      style={{ width: `${(bar.amount / maxAgingAmount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}

              {totalOutstanding > 0 && (
                <div className="pt-3 border-t border-border">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Collection rate</span>
                    <span className="font-semibold text-foreground">
                      {collectionRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overdue invoices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Overdue Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {overdueInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <p className="text-sm text-muted-foreground">No overdue invoices</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-medium">Invoice #</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Customer</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Amount</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Due Date</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Days Overdue</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {overdueInvoices.map((invoice) => {
                    const severity =
                      invoice.days_overdue > 90
                        ? "destructive"
                        : invoice.days_overdue > 30
                        ? "warning"
                        : "secondary";
                    return (
                      <tr key={invoice.invoice_id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-mono text-xs text-muted-foreground">
                          {invoice.invoice_number}
                        </td>
                        <td className="py-2.5 font-medium text-foreground">{invoice.entity_name}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold">
                          {formatCurrency(invoice.amount, "INR", true)}
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground">
                          {formatDate(invoice.due_date)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Badge variant={severity}>
                            {invoice.days_overdue}d
                          </Badge>
                        </td>
                        <td className="py-2.5 text-right">
                          <Button size="sm" variant="ghost" className="gap-1.5 h-7 px-2" asChild>
                            <Link
                              href={`/dashboard/intelligence?ask=Draft reminder for ${encodeURIComponent(invoice.entity_name)}`}
                            >
                              <Send className="h-3 w-3" />
                              Send
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
