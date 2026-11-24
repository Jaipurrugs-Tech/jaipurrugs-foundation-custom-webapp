import type { ReactNode } from "react";
import Link from "next/link";
import { bookingChannelLabel, programLabel, visitorCategoryLabel } from "@/lib/visits/constants";
import {
  ALL_PROGRAMS,
  formatInr,
  type CategoryRevenueRow,
  type DashboardFilters as Filters,
  type DashboardStats,
  type LabelValue,
  type RevenueStats,
} from "@/lib/visits/dashboard";
import { formatDate } from "@/lib/visits/time";
import { StatCard } from "../visits/stat-card";
import { IncomeBarChart, MonthlyAreaChart, RankedBarChart } from "./charts";
import type { DashboardAttention } from "@/lib/dashboard/attention";
import { DashboardFilters } from "./dashboard-filters";
import { NeedsAttention } from "./needs-attention";
import type { ReviewRating } from "@/lib/dashboard/review-rating";

/** Equal-width tile columns; on wide screens Operations (4) and Reach (3) share one row, so 7 tiles fill it. */
const TILE_GRID = "grid grid-cols-2 gap-3";

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

function ChartCard({
  title,
  hint,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border border-border bg-white p-4 shadow-2xs ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}


function NpsCard({ rating }: { rating: ReviewRating | null }) {
  const href = "/partners?tab=reviews";
  if (!rating) return <StatCard compact href={href} label="NPS" value="—" hint="Could not be loaded" />;
  if (rating.average === null) return <StatCard compact href={href} label="NPS" value="—" hint="No reviews yet" />;
  return (
    <StatCard
      compact
      href={href}
      label="NPS"
      value={`${rating.average.toFixed(1)} / 5`}
      hint={`★ avg of ${rating.rated} review${rating.rated === 1 ? "" : "s"}`}
    />
  );
}

/** Turns stored ids into display labels on the server, before the data reaches a client chart. */
function relabel(items: LabelValue[], labelFor: (id: string) => string): LabelValue[] {
  return items.map((item) => ({ ...item, label: labelFor(item.label) }));
}

const sumOf = (rows: CategoryRevenueRow[], key: keyof Omit<CategoryRevenueRow, "category">) =>
  rows.reduce((total, row) => total + row[key], 0);

/** Bookings, revenue and artisan payments for each visitor category. */
function CategoryTable({ rows }: { rows: CategoryRevenueRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">No completed visits in this period.</p>;
  }
  const columns = [
    { key: "bookings", label: "Bookings", money: false },
    { key: "visitors", label: "Visitors", money: false },
    { key: "revenue", label: "Rural Experience revenue", money: true },
    { key: "jr_sales", label: "JR sales", money: true },
    { key: "jr_farms", label: "JR Farms sales", money: true },
    { key: "artisan_payments", label: "Artisan payments", money: true },
  ] as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="py-2 pr-4 font-medium">Visitor category</th>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row) => (
            <tr key={row.category}>
              <td className="py-2 pr-4 font-medium">
                {row.category === "unspecified" ? "Not specified" : visitorCategoryLabel(row.category)}
              </td>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                  {c.money ? formatInr(row[c.key]) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td className="py-2 pr-4">Total</td>
            {columns.map((c) => (
              <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                {c.money ? formatInr(sumOf(rows, c.key)) : sumOf(rows, c.key)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function DashboardView({
  attention,
  stats,
  revenue,
  filters,
  villages,
  reviewRating,
}: {
  /** Null when the attention panel could not be loaded. */
  attention: DashboardAttention | null;
  stats: DashboardStats;
  /** Null when the revenue numbers could not be loaded. */
  revenue: RevenueStats | null;
  filters: Filters;
  villages: { id: string; name: string }[];
  /** Null when the review rating could not be loaded. */
  reviewRating: ReviewRating | null;
}) {
  const { operations, reach, economic, quality, innovation } = stats;
  const programName = filters.program === ALL_PROGRAMS ? "" : `${programLabel(filters.program)} `;
  const hasAnyData = reach.visits > 0 || operations.upcoming_visits > 0 || operations.completed_in_range > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">
            {filters.rangeLabel}: {formatDate(filters.from)} – {formatDate(filters.to)}. Reach and income count
            completed {programName}visits only.
          </p>
        </div>
        <DashboardFilters filters={filters} villages={villages} />
      </div>

      {attention ? <NeedsAttention attention={attention} /> : null}

      {!hasAnyData ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted">
          No visits match this period and these filters yet. Add visits on <Link className="text-accent" href="/trips">Trips</Link> and mark
          them completed — reach, income and guest numbers appear here as soon as they are.
        </div>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-[4fr_3fr] xl:gap-3">
      <Section title="Operations" description="What needs attention now.">
        <div className={`${TILE_GRID} sm:grid-cols-4`}>
          <StatCard compact href="/trips?view=calendar" label="Upcoming visits" value={operations.upcoming_visits} hint={`${operations.upcoming_guests} guests`} />
          <StatCard compact href="/trips?view=grid" label="Completed" value={operations.completed_in_range} hint="in period" />
          {quality.avg_rating === null || quality.feedback_count === 0 ? (
            <StatCard compact href="/forms" label="Guest satisfaction" value="—" hint="No feedback yet" />
          ) : (
            <StatCard
              compact
              href="/forms"
              label="Guest satisfaction"
              value={`${quality.avg_rating.toFixed(1)} / 5`}
              hint={`${quality.feedback_count} response${quality.feedback_count === 1 ? "" : "s"}`}
            />
          )}
          <NpsCard rating={reviewRating} />
        </div>
      </Section>

      <Section title="Reach & economic value" description="Completed visits in the period.">
        <div className={`${TILE_GRID} sm:grid-cols-3`}>
          <StatCard compact href="/trips?view=grid" label="Visitors" value={reach.visitors} hint={`${reach.visits} visits`} />
          <StatCard compact href={`/finance?from=${filters.from}&to=${filters.to}`} label="Total income" value={formatInr(economic.total_income)} hint="tax invoices incl. GST, else PIs" />
          <StatCard
            compact
            href="/finance/payouts"
            label="To artisan families"
            value={formatInr(economic.income_to_artisans)}
            hint={economic.pct_to_artisans === null ? undefined : `${economic.pct_to_artisans}% of income`}
          />
        </div>
      </Section>
      </div>

      <section className="-mt-3 flex flex-col gap-3">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard hint="charged vs paid to artisan families" title="Income by month">
            <IncomeBarChart data={economic.monthly} />
          </ChartCard>
          <ChartCard hint="headcount per month" title="Visitors per month">
            <MonthlyAreaChart data={reach.monthly} dataKey="visitors" label="Visitors" />
          </ChartCard>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard hint="completed visits" title="By booking channel">
            <RankedBarChart data={relabel(reach.by_channel, (id) => (id === "partner_agency" ? "Agency" : bookingChannelLabel(id)))} />
          </ChartCard>
          <ChartCard hint="completed visits" title="By visitor category">
            <RankedBarChart color="var(--chart-2)" data={relabel(reach.by_category, visitorCategoryLabel)} />
          </ChartCard>
          <ChartCard hint="completed visits" title="By village">
            <RankedBarChart color="var(--chart-4)" data={reach.by_village} />
          </ChartCard>
        </div>
      </section>

      {revenue ? (
        <>
          <Section
            title="Revenue by source"
            description="Kept apart so each source can be reconciled against its invoices. Completed visits in the period."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Rural Experience"
                value={formatInr(revenue.streams.rural_experience.amount)}
                hint={`Before GST · ${revenue.streams.rural_experience.invoices} proforma invoice${revenue.streams.rural_experience.invoices === 1 ? "" : "s"} · ${revenue.streams.rural_experience.visits} visit${revenue.streams.rural_experience.visits === 1 ? "" : "s"}`}
              />
              <StatCard
                label="JR sales"
                value={formatInr(revenue.streams.jr_sales.amount)}
                hint={`${revenue.streams.jr_sales.invoices} invoice${revenue.streams.jr_sales.invoices === 1 ? "" : "s"} · ${revenue.streams.jr_sales.visits} visit${revenue.streams.jr_sales.visits === 1 ? "" : "s"}`}
              />
              <StatCard
                label="JR Farms sales"
                value={formatInr(revenue.streams.jr_farms.amount)}
                hint={`${revenue.streams.jr_farms.invoices} invoice${revenue.streams.jr_farms.invoices === 1 ? "" : "s"} · ${revenue.streams.jr_farms.visits} visit${revenue.streams.jr_farms.visits === 1 ? "" : "s"}`}
              />
            </div>
          </Section>

          <Section title="By visitor category" description="Bookings, revenue and artisan payments for each kind of visitor.">
            <ChartCard title="Visitor category breakdown" hint="completed visits">
              <CategoryTable rows={revenue.by_category} />
            </ChartCard>
          </Section>
        </>
      ) : null}

      <Section
        title="Innovation"
        description="The model replicating into different crafts, regions and partner types is a stronger scaling claim than identical copies."
      >
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Craft types" value={innovation.craft_types} />
          <StatCard label="Regions" value={innovation.regions} />
          <StatCard label="Partner types" value={innovation.partner_types} />
        </div>
        <ChartCard title="Village growth over time">
          {innovation.timeline.length === 0 ? (
            <p className="text-sm text-muted">
              No villages with an &ldquo;active since&rdquo; date yet. Add one on the Villages page.
            </p>
          ) : (
            <ol className="flex flex-col divide-y divide-border/60">
              {innovation.timeline.map((entry) => (
                <li key={entry.village} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                  <span className="w-6 text-right tabular-nums text-muted">{entry.cumulative}</span>
                  <span className="min-w-32 font-medium">{entry.village}</span>
                  <span className="w-28 text-muted">{formatDate(entry.active_since)}</span>
                  <span className="text-muted">
                    {[entry.craft, entry.region, entry.partner_type].filter(Boolean).join(" · ") || "—"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </ChartCard>
      </Section>
    </div>
  );
}
