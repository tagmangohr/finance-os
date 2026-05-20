import type { SupabaseClient } from '@supabase/supabase-js';
import type { CollectionsResult } from './types';

export async function calculateCollections(
  orgId: string,
  supabase: SupabaseClient
): Promise<CollectionsResult> {
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);
  const todayStr = today.toISOString().split('T')[0];
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // Fetch outstanding invoices and recently paid ones in parallel
  const [outstandingResult, paidResult] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, entity_id, amount, due_date, status, entities(name)')
      .eq('org_id', orgId)
      .in('status', ['sent', 'overdue']),
    supabase
      .from('invoices')
      .select('amount')
      .eq('org_id', orgId)
      .eq('status', 'paid')
      .gte('paid_date', fmt(ninetyDaysAgo)),
  ]);

  const outstanding = outstandingResult.data ?? [];
  const paidInvoices = paidResult.data ?? [];

  // Bucket by days overdue
  let overdue_0_30 = 0;
  let overdue_31_60 = 0;
  let overdue_61_90 = 0;
  let overdue_90_plus = 0;
  let totalOutstanding = 0;

  // Track entity-level aggregation for top debtors
  const entityMap = new Map<
    string,
    { name: string; amount: number; max_days_overdue: number }
  >();

  for (const inv of outstanding) {
    const amount = Number(inv.amount);
    totalOutstanding += amount;

    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.max(
      0,
      Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    if (daysOverdue <= 30) {
      overdue_0_30 += amount;
    } else if (daysOverdue <= 60) {
      overdue_31_60 += amount;
    } else if (daysOverdue <= 90) {
      overdue_61_90 += amount;
    } else {
      overdue_90_plus += amount;
    }

    // Accumulate per entity
    const entityId = inv.entity_id;
    // entities is a joined object (could be null if relation missing)
    const entityName =
      (inv.entities as unknown as { name: string } | null)?.name ??
      'Unknown Entity';

    const existing = entityMap.get(entityId);
    if (existing) {
      existing.amount += amount;
      existing.max_days_overdue = Math.max(
        existing.max_days_overdue,
        daysOverdue
      );
    } else {
      entityMap.set(entityId, {
        name: entityName,
        amount,
        max_days_overdue: daysOverdue,
      });
    }
  }

  // Collection rate: paid / (paid + outstanding) in last 90 days
  const totalPaid90d = paidInvoices.reduce(
    (sum, i) => sum + Number(i.amount),
    0
  );
  const collectionRate =
    totalPaid90d + totalOutstanding > 0
      ? (totalPaid90d / (totalPaid90d + totalOutstanding)) * 100
      : 100;

  // Top debtors sorted by outstanding amount desc
  const topDebtors = Array.from(entityMap.entries())
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10)
    .map(([entity_id, data]) => ({
      entity_id,
      name: data.name,
      amount: data.amount,
      days_overdue: data.max_days_overdue,
    }));

  return {
    total_outstanding: totalOutstanding,
    overdue_0_30,
    overdue_31_60,
    overdue_61_90,
    overdue_90_plus,
    collection_rate: collectionRate,
    top_debtors: topDebtors,
  };
}
