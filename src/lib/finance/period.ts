import { shiftMonth, todayIST } from "@/lib/visits/time";

// The Finance overview's period, read from the URL. Presets follow the Indian
// financial year (April–March); a valid ?from=&to= pair is a custom range.

export const FINANCE_PERIODS = [
  { id: "fy", label: "This FY" },
  { id: "last_fy", label: "Last FY" },
  { id: "3m", label: "3 mo" },
  { id: "12m", label: "12 mo" },
] as const;

export type FinancePeriodId = (typeof FINANCE_PERIODS)[number]["id"] | "custom";

export type FinancePeriod = { id: FinancePeriodId; label: string; from: string; to: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366 * 6;

function isValidDate(value: string | undefined): value is string {
  return Boolean(value && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

/** The year the financial year containing `date` starts in (FY 2026-27 -> 2026). */
function fyStartYear(date: string) {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

function fyLabel(startYear: number) {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function resolveFinancePeriod(
  params: { period?: string; from?: string; to?: string },
  today: string = todayIST(),
): FinancePeriod {
  const { from, to } = params;
  if (
    isValidDate(from) &&
    isValidDate(to) &&
    from <= to &&
    (Date.parse(to) - Date.parse(from)) / 86_400_000 <= MAX_RANGE_DAYS
  ) {
    return { id: "custom", label: "Custom range", from, to };
  }

  const fy = fyStartYear(today);
  switch (params.period) {
    case "last_fy":
      return { id: "last_fy", label: fyLabel(fy - 1), from: `${fy - 1}-04-01`, to: `${fy}-03-31` };
    case "3m":
      return { id: "3m", label: "Last 3 months", from: `${shiftMonth(today.slice(0, 7), -2)}-01`, to: today };
    case "12m":
      return { id: "12m", label: "Last 12 months", from: `${shiftMonth(today.slice(0, 7), -11)}-01`, to: today };
    default:
      return { id: "fy", label: `${fyLabel(fy)} to date`, from: `${fy}-04-01`, to: today };
  }
}
