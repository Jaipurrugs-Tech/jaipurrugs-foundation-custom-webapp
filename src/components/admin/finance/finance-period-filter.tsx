"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateField, DateRangePicker, Label, RangeCalendar } from "@heroui/react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { FINANCE_PERIODS, type FinancePeriod } from "@/lib/finance/period";

type DateRange = { start: CalendarDate; end: CalendarDate };

/** Period presets (Indian FY) and a custom date range. Lives in the URL, so the server renders the numbers. */
export function FinancePeriodFilter({ period }: { period: FinancePeriod }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigate(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString();
    startTransition(() => router.push(query ? `/finance?${query}` : "/finance", { scroll: false }));
  }

  return (
    <div
      aria-busy={isPending}
      className={`flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-white p-4 transition-opacity ${
        isPending ? "opacity-70" : ""
      }`}
    >
      <nav aria-label="Period" className="flex gap-1 rounded-xl bg-neutral-100 p-1">
        {FINANCE_PERIODS.map((preset) => (
          <button
            key={preset.id}
            aria-current={preset.id === period.id ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              preset.id === period.id ? "bg-white font-medium shadow-sm" : "text-muted hover:text-foreground"
            }`}
            type="button"
            onClick={() => navigate(preset.id === "fy" ? {} : { period: preset.id })}
          >
            {preset.label}
          </button>
        ))}
      </nav>

      <DateRangePicker
        className="w-64"
        value={{ start: parseDate(period.from), end: parseDate(period.to) }}
        onChange={(next) => {
          const value = next as DateRange | null;
          if (value) navigate({ from: value.start.toString(), to: value.end.toString() });
        }}
      >
        <Label>Dates</Label>
        <DateField.Group fullWidth>
          <DateField.Input slot="start">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          <DateRangePicker.RangeSeparator />
          <DateField.Input slot="end">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          <DateField.Suffix>
            <DateRangePicker.Trigger>
              <DateRangePicker.TriggerIndicator />
            </DateRangePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <DateRangePicker.Popover>
          <RangeCalendar aria-label="Finance dates">
            <RangeCalendar.Header>
              <RangeCalendar.YearPickerTrigger>
                <RangeCalendar.YearPickerTriggerHeading />
                <RangeCalendar.YearPickerTriggerIndicator />
              </RangeCalendar.YearPickerTrigger>
              <RangeCalendar.NavButton slot="previous" />
              <RangeCalendar.NavButton slot="next" />
            </RangeCalendar.Header>
            <RangeCalendar.Grid>
              <RangeCalendar.GridHeader>
                {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
              </RangeCalendar.GridHeader>
              <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
            </RangeCalendar.Grid>
            <RangeCalendar.YearPickerGrid>
              <RangeCalendar.YearPickerGridBody>
                {({ year }) => <RangeCalendar.YearPickerCell year={year} />}
              </RangeCalendar.YearPickerGridBody>
            </RangeCalendar.YearPickerGrid>
          </RangeCalendar>
        </DateRangePicker.Popover>
      </DateRangePicker>
    </div>
  );
}
