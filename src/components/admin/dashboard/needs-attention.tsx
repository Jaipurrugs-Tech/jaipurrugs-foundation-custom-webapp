import type { ReactNode } from "react";
import Link from "next/link";
import type { DashboardAttention } from "@/lib/dashboard/attention";
import { formatInr } from "@/lib/visits/dashboard";
import { formatDate, todayIST } from "@/lib/visits/time";

function AttentionCard({
  title,
  summary,
  href,
  linkLabel,
  children,
}: {
  title: string;
  summary: string;
  href: string;
  linkLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-white p-4 shadow-2xs">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Link className="shrink-0 text-xs text-accent hover:underline" href={href}>
          {linkLabel} →
        </Link>
      </div>
      <p className="text-xs text-muted">{summary}</p>
      {children}
    </div>
  );
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** What needs doing now: unpaid PIs, artisan payouts due, failed WhatsApp sends, and the week's trips. */
export function NeedsAttention({ attention }: { attention: DashboardAttention }) {
  const { unpaidInvoices, pendingPayouts, failedMessages, upcomingTrips } = attention;
  const today = todayIST();
  const hasAny =
    unpaidInvoices.count > 0 || pendingPayouts.count > 0 || failedMessages > 0 || upcomingTrips.length > 0;
  if (!hasAny) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Needs attention</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {upcomingTrips.length > 0 ? (
          <AttentionCard
            href="/trips"
            linkLabel="Trips"
            summary={`${plural(upcomingTrips.length, "trip")} in the next 7 days`}
            title="Coming up"
          >
            <ul className="flex flex-col divide-y divide-border/60 text-sm">
              {upcomingTrips.map((trip) => (
                <li key={trip.id}>
                  <Link
                    className="flex flex-col py-1.5 hover:text-accent"
                    href={`/trips?visit=${trip.id}`}
                  >
                    <span className="flex justify-between gap-2">
                      <span className="font-medium">{trip.date === today ? "Today" : formatDate(trip.date)}</span>
                      {trip.headcount ? (
                        <span className="text-xs tabular-nums text-muted">{plural(trip.headcount, "guest")}</span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {[trip.type, trip.contact].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </AttentionCard>
        ) : null}

        {unpaidInvoices.count > 0 ? (
          <AttentionCard
            href="/finance/invoices"
            linkLabel="Invoices"
            summary={`${plural(unpaidInvoices.count, "proforma invoice")} · ${formatInr(unpaidInvoices.total)} outstanding`}
            title="Unpaid proforma invoices"
          >
            <ul className="flex flex-col divide-y divide-border/60 text-sm">
              {unpaidInvoices.top.map((pi) => (
                <li key={pi.id}>
                  <Link className="flex items-baseline justify-between gap-2 py-1.5 hover:text-accent" href={`/invoices/${pi.id}`}>
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{pi.piNumber}</span>{" "}
                      <span className="text-xs text-muted">{pi.client}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatInr(pi.balance)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </AttentionCard>
        ) : null}

        {pendingPayouts.count > 0 ? (
          <AttentionCard
            href="/finance/payouts"
            linkLabel="Payouts"
            summary={`${plural(pendingPayouts.count, "trip")} · ${formatInr(pendingPayouts.total)} still to pay artisans`}
            title="Artisan payouts due"
          >
            <ul className="flex flex-col divide-y divide-border/60 text-sm">
              {pendingPayouts.top.map((p) => (
                <li key={p.visitId}>
                  <Link className="flex items-baseline justify-between gap-2 py-1.5 hover:text-accent" href="/finance/payouts">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{p.label}</span>
                      {p.villages ? <span className="text-xs text-muted"> · {p.villages}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatInr(p.pending)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </AttentionCard>
        ) : null}

        {failedMessages > 0 ? (
          <AttentionCard
            href="/messaging"
            linkLabel="Messaging"
            summary="Scheduled sends that failed or could not be confirmed."
            title="WhatsApp messages"
          >
            <p className="text-3xl font-bold text-danger">{failedMessages}</p>
          </AttentionCard>
        ) : null}
      </div>
    </section>
  );
}
