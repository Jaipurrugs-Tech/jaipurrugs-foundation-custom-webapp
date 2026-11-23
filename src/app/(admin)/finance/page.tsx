import type { ReactNode } from "react";
import Link from "next/link";
import { FinancePeriodFilter } from "@/components/admin/finance/finance-period-filter";
import { StatCard } from "@/components/admin/visits/stat-card";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { expenseCategoryLabel } from "@/lib/finance/constants";
import { resolveFinancePeriod } from "@/lib/finance/period";
import { loadFinanceOverview } from "@/lib/finance/queries";
import { formatRupees } from "@/lib/invoices/calc";
import { createClient } from "@/lib/supabase/server";
import { formatDate, shortMonthLabel } from "@/lib/visits/time";

export const dynamic = "force-dynamic";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4 shadow-2xs">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Amount({ value, tone }: { value: number; tone?: "negative" | "signed" }) {
  const color = tone === "negative" || (tone === "signed" && value < 0) ? "text-danger" : "";
  return <span className={`tabular-nums ${color}`}>{formatRupees(value)}</span>;
}

export default async function FinanceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  await requireActiveTeamMember();
  const period = resolveFinancePeriod(await searchParams);
  const supabase = await createClient();
  const o = await loadFinanceOverview(supabase, period.from, period.to);

  const incomeRows = [
    { label: "Rural Experience (PIs, excl. GST)", value: o.ruralExperience },
    { label: "JR Sales (attributed to trips)", value: o.jrSales },
    { label: "JR Farms (attributed to trips)", value: o.jrFarms },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Finance</h1>
        <p className="text-sm text-muted">
          {period.label}: {formatDate(period.from)} – {formatDate(period.to)}. Money in is tax invoices for paid trips;
          money out is artisan payouts and expenses.
        </p>
      </div>

      <FinancePeriodFilter period={period} />

      <Section title="Cash flow" description="Money that actually moved in the period.">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Received" value={formatRupees(o.received)} hint="tax invoices" />
          <StatCard label="Artisan payouts" value={formatRupees(o.payouts)} />
          <StatCard label="Expenses" value={formatRupees(o.expenses)} />
          <StatCard label="Net" value={<Amount tone="signed" value={o.net} />} hint="received − payouts − expenses" />
        </div>
      </Section>

      <Section title="Needs attention" description="Open right now, whatever the period.">
        <div className="grid grid-cols-2 gap-4">
          <Link className="rounded-2xl transition-opacity hover:opacity-80" href="/finance/invoices">
            <StatCard
              label="Outstanding from clients"
              value={formatRupees(o.outstanding.amount)}
              hint={`${o.outstanding.invoices} proforma invoice${o.outstanding.invoices === 1 ? "" : "s"}`}
            />
          </Link>
          <Link className="rounded-2xl transition-opacity hover:opacity-80" href="/finance/payouts">
            <StatCard
              label="Due to artisan families"
              value={formatRupees(o.pendingPayouts.amount)}
              hint={`${o.pendingPayouts.visits} completed trip${o.pendingPayouts.visits === 1 ? "" : "s"}`}
            />
          </Link>
        </div>
      </Section>

      <Section title="Income" description="Earned in the period, whether or not it has been received yet.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card hint={`GST billed on top: ${formatRupees(o.gst)}`} title="By stream">
            <table className="w-full text-sm">
              <tbody>
                {incomeRows.map((row) => (
                  <tr key={row.label} className="border-b border-border/60">
                    <td className="py-2">{row.label}</td>
                    <td className="py-2 text-right">
                      <Amount value={row.value} />
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2">Total income</td>
                  <td className="py-2 text-right">
                    <Amount value={o.income} />
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card hint="in the period" title="Expenses by category">
            {o.expensesByCategory.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No expenses recorded for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {o.expensesByCategory.map((row) => (
                    <tr key={row.category} className="border-b border-border/60 last:border-0">
                      <td className="py-2">{expenseCategoryLabel(row.category)}</td>
                      <td className="py-2 text-right text-muted">
                        {o.expenses > 0 ? `${Math.round((row.amount / o.expenses) * 100)}%` : ""}
                      </td>
                      <td className="w-32 py-2 text-right">
                        <Amount value={row.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </Section>

      <Section title="Month by month">
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-2xs">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-semibold">Month</th>
                <th className="px-4 py-3 text-right font-semibold">Received</th>
                <th className="px-4 py-3 text-right font-semibold">Artisan payouts</th>
                <th className="px-4 py-3 text-right font-semibold">Expenses</th>
                <th className="px-4 py-3 text-right font-semibold">Net</th>
              </tr>
            </thead>
            <tbody>
              {o.months.map((m) => (
                <tr key={m.month} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5">{shortMonthLabel(m.month)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Amount value={m.received} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Amount value={m.payouts} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Amount value={m.expenses} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    <Amount tone="signed" value={m.net} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
