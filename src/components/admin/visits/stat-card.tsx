import type { ReactNode } from "react";

/** Same card shell as the form metrics cards (src/components/admin/metrics). */
export function StatCard({
  label,
  value,
  hint,
  icon,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  /** Tighter padding and a smaller number, for rows of small tiles. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-white px-3 py-2.5 shadow-2xs">
        <div className="flex items-center justify-between gap-2 text-muted">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider">{label}</span>
          {icon}
        </div>
        <span className="text-2xl font-bold leading-tight text-foreground">{value}</span>
        {hint ? <span className="truncate text-xs text-muted" title={hint}>{hint}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-white p-4 shadow-2xs">
      <div className="flex items-center justify-between text-muted">
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-foreground">{value}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
    </div>
  );
}
