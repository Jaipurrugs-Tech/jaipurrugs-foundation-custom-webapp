"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  Calendar,
  Ellipsis,
  Envelope,
  LayoutCells,
  Pencil,
  Persons,
  Plus,
  Xmark,
} from "@gravity-ui/icons";
import {
  Button,
  Chip,
  DateField,
  DateRangePicker,
  Dropdown,
  Label,
  RangeCalendar,
  SearchField,
  Table,
  Tabs,
  toast,
} from "@heroui/react";
import type { CalendarDate } from "@internationalized/date";
import { setVisitDetailView, setVisitStatus } from "@/lib/actions/visits";
import { formatPhone, toWhatsAppParticipantId } from "@/lib/mastra/phone";
import { toCsv } from "@/lib/csv";
import { downloadCsv } from "@/lib/download-csv";
import {
  PROGRAM_CATEGORIES,
  VISIT_STATUSES,
  bookingChannelLabel,
  visitStatusLabel,
  visitorCategoryLabel,
  type VisitDetailView,
} from "@/lib/visits/constants";
import { formatDateRange, formatTimeRange } from "@/lib/visits/time";
import type { VisitListItem, VisitReference } from "@/lib/visits/types";
import { VisitMessagingModal, useVisitMessaging } from "../messaging/visit-messaging-modal";
import { VisitsCalendar } from "./calendar-view";
import { ALL, FilterSelect } from "./filter-select";
import { TaxInvoiceDialog } from "../finance/tax-invoice-dialog";
import { TripInvoicesCell } from "./trip-invoices-cell";
import { VisitDetailPanel } from "./visit-detail-panel";
import { VisitFormModal } from "./visit-form-modal";
import { VisitGuestsModal, useVisitGuests } from "./visit-guests-modal";
import { VisitStatusChip } from "./visit-status-chip";

export type TripsViewMode = "calendar" | "grid";

// Filters sit two to a row on phones and at their own width from `sm` up.
const FILTER_WIDTH = "w-[calc(50%-0.375rem)] sm:w-44";


type DateRange = { start: CalendarDate; end: CalendarDate };

function DateRangeFilter({ value, onChange }: { value: DateRange | null; onChange: (value: DateRange | null) => void }) {
  return (
    <div className="flex w-full items-end gap-1 sm:w-auto">
      <DateRangePicker className="min-w-0 flex-1 sm:w-64 sm:flex-none" value={value} onChange={(next) => onChange(next as DateRange | null)}>
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
          <RangeCalendar aria-label="Filter by dates">
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
      {value ? (
        <Button isIconOnly aria-label="Clear dates" variant="ghost" onPress={() => onChange(null)}>
          <Xmark className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function VisitActionsMenu({
  visit,
  onEdit,
  onGuests,
  onMessages,
  onStatusChange,
}: {
  visit: VisitListItem;
  onEdit: () => void;
  onGuests: () => void;
  onMessages: () => void;
  onStatusChange: (status: string) => void;
}) {
  return (
    <Dropdown>
      <Button isIconOnly aria-label="Trip actions" size="sm" variant="ghost">
        <Ellipsis className="size-4" />
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "edit") onEdit();
            else if (key === "guests") onGuests();
            else if (key === "messages") onMessages();
          }}
        >
          <Dropdown.Item id="edit" textValue="Edit trip">
            <Pencil className="size-4 shrink-0 text-muted" />
            <Label>Edit trip</Label>
          </Dropdown.Item>
          <Dropdown.Item id="guests" textValue="Manage guests">
            <Persons className="size-4 shrink-0 text-muted" />
            <Label>Manage guests</Label>
          </Dropdown.Item>
          <Dropdown.Item id="messages" textValue="Scheduled messages">
            <Envelope className="size-4 shrink-0 text-muted" />
            <Label>Scheduled messages</Label>
          </Dropdown.Item>
          <Dropdown.SubmenuTrigger>
            <Dropdown.Item id="status" textValue="Change status">
              <span aria-hidden className="size-4 shrink-0" />
              <Label>Change status</Label>
              <Dropdown.SubmenuIndicator />
            </Dropdown.Item>
            <Dropdown.Popover>
              <Dropdown.Menu
                selectedKeys={new Set([visit.status])}
                selectionMode="single"
                onAction={(key) => onStatusChange(String(key))}
              >
                {VISIT_STATUSES.map((s) => (
                  <Dropdown.Item key={s.id} id={s.id} textValue={s.label}>
                    <Dropdown.ItemIndicator />
                    <Label>{s.label}</Label>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.SubmenuTrigger>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/** tel: link for a stored phone number (digits with country code when we can tell). */
function telHref(phone: string) {
  const digits = toWhatsAppParticipantId(phone);
  return digits ? `tel:+${digits}` : `tel:${phone}`;
}

const EXPORT_HEADERS = [
  "Date",
  "End date",
  "Start time",
  "End time",
  "Programs",
  "Status",
  "Primary contact",
  "Primary contact phone",
  "Primary contact email",
  "Institute / source",
  "Coming from",
  "Visitor category",
  "Booking channel",
  "Headcount",
  "Villages",
  "Facilitators",
  "Tax invoice numbers",
  "Tax invoice total",
  "PI numbers",
];

/** Trips and calendar in one place: shared filters, two ways to look at the result. */
export function TripsView({
  visits,
  reference,
  today,
  initialView,
  initialMonth,
  initialVisitId,
  initialDetailView,
}: {
  visits: VisitListItem[];
  reference: VisitReference;
  today: string;
  initialView: TripsViewMode;
  /** Sidebar or pop-up, as this user last chose. */
  initialDetailView: VisitDetailView;
  initialMonth: string;
  /** Opens this visit's details on load (links from elsewhere, e.g. the inbox). */
  initialVisitId: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<TripsViewMode>(initialView);
  const [month, setMonth] = useState(initialMonth);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(ALL);
  const [program, setProgram] = useState(ALL);
  const [villageId, setVillageId] = useState(ALL);
  const [facilitatorId, setFacilitatorId] = useState(ALL);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  const [detailId, setDetailId] = useState<string | null>(initialVisitId);
  const [isDetailOpen, setIsDetailOpen] = useState(initialVisitId !== null);
  const [detailView, setDetailView] = useState<VisitDetailView>(initialDetailView);
  const [editing, setEditing] = useState<VisitListItem | null>(null);
  // The trip whose "Add invoice" was pressed: the tax invoice form opens right here.
  const [invoiceTrip, setInvoiceTrip] = useState<{ id: string; label: string } | null>(null);
  const [formDate, setFormDate] = useState(today);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const guestsModal = useVisitGuests();
  const messaging = useVisitMessaging();

  // Looked up from the latest data so the drawer reflects edits after a refresh.
  const detailVisit = visits.find((v) => v.id === detailId) ?? null;
  const villageName = useMemo(() => new Map(reference.villages.map((v) => [v.id, v.name])), [reference.villages]);
  const facilitatorName = useMemo(
    () => new Map(reference.facilitators.map((f) => [f.id, f.name])),
    [reference.facilitators],
  );
  /** All the trip's facilitators, main first; trips from before facilitators show the typed name. */
  const facilitatorNames = (v: VisitListItem) =>
    v.facilitatorIds.length
      ? v.facilitatorIds.map((id) => facilitatorName.get(id) ?? "Unknown").join(", ")
      : (v.poc_name ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = dateRange?.start.toString();
    const to = dateRange?.end.toString();
    return visits.filter((v) => {
      if (status !== ALL && v.status !== status) return false;
      if (program !== ALL && !(v.program_categories ?? [v.program_category]).includes(program)) return false;
      if (villageId !== ALL && !v.villageIds.includes(villageId)) return false;
      if (facilitatorId !== ALL && !v.facilitatorIds.includes(facilitatorId)) return false;
      if (from && to) {
        // Keep visits that overlap the chosen range.
        if (!v.visit_date) return false;
        if (v.visit_date > to || (v.end_date ?? v.visit_date) < from) return false;
      }
      if (!q) return true;
      return [
        v.visit_type,
        v.poc_name ?? "",
        v.poc_phone ?? "",
        v.primaryGuest?.name ?? "",
        v.primaryGuest?.phone ?? "",
        v.primaryGuest?.email ?? "",
        v.facilitator ?? "",
        facilitatorNames(v),
        v.visitor_category ? visitorCategoryLabel(v.visitor_category) : "",
        v.visitor_group ?? "",
        v.source ?? "",
        v.origin_place ?? "",
        v.notes ?? "",
        ...v.villageIds.map((id) => villageName.get(id) ?? ""),
      ].some((s) => s.toLowerCase().includes(q));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- facilitatorNames derives from facilitatorName
  }, [visits, status, program, villageId, facilitatorId, dateRange, query, villageName, facilitatorName]);

  const filtersActive = query !== "" || status !== ALL || program !== ALL || villageId !== ALL || facilitatorId !== ALL || dateRange !== null;

  function changeView(next: TripsViewMode) {
    setView(next);
    // Keep the view in the URL so a reload or shared link lands on the same one.
    window.history.replaceState(null, "", `/trips?view=${next}`);
  }

  function changeDateRange(next: DateRange | null) {
    setDateRange(next);
    if (next) setMonth(next.start.toString().slice(0, 7));
  }

  function clearFilters() {
    setQuery("");
    setStatus(ALL);
    setProgram(ALL);
    setVillageId(ALL);
    setFacilitatorId(ALL);
    setDateRange(null);
  }

  function openDetail(visit: VisitListItem) {
    setDetailId(visit.id);
    setIsDetailOpen(true);
  }

  function openForm(visit: VisitListItem | null, date = today) {
    setIsDetailOpen(false);
    setEditing(visit);
    setFormDate(date);
    setIsFormOpen(true);
  }

  function handleRowAction(key: React.Key) {
    const visit = visits.find((v) => v.id === String(key));
    if (visit) openDetail(visit);
  }

  async function handleStatusChange(visit: VisitListItem, next: string) {
    if (next === visit.status) return;
    const result = await setVisitStatus(visit.id, next);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    toast.success(`Status changed to ${visitStatusLabel(next)}`);
    router.refresh();
  }

  async function changeDetailView(next: VisitDetailView) {
    setDetailView(next);
    const result = await setVisitDetailView(next);
    if (result.error) toast.danger(result.error);
  }

  /** Downloads the trips that match the current filters as a CSV (built here from the loaded list). */
  function exportCsv() {
    const rows = filtered.map((v) => [
      v.visit_date,
      v.end_date,
      v.start_time?.slice(0, 5),
      v.end_time?.slice(0, 5),
      v.visit_type,
      visitStatusLabel(v.status),
      v.primaryGuest ? v.primaryGuest.name : v.poc_name,
      v.primaryGuest ? formatPhone(v.primaryGuest.phone) : v.poc_phone,
      v.primaryGuest?.email,
      v.source,
      v.origin_place,
      v.visitor_category ? visitorCategoryLabel(v.visitor_category) : v.visitor_group,
      v.booking_channel ? bookingChannelLabel(v.booking_channel) : null,
      v.headcount,
      v.villageIds.map((id) => villageName.get(id) ?? "Unknown").join(", "),
      facilitatorNames(v),
      v.taxInvoices.map((t) => t.invoice_number).join(", "),
      v.taxInvoices.length ? v.taxInvoices.reduce((sum, t) => sum + Number(t.amount ?? 0), 0) : null,
      v.invoices.map((i) => i.pi_number).filter(Boolean).join(", "),
    ]);
    downloadCsv(toCsv(EXPORT_HEADERS, rows), `trips-${today}.csv`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs selectedKey={view} onSelectionChange={(key) => changeView(key as TripsViewMode)}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="View">
              <Tabs.Tab id="grid">
                <LayoutCells className="size-4" />
                Grid
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="calendar">
                <Calendar className="size-4" />
                Calendar
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          {view === "grid" ? (
            <Button isDisabled={filtered.length === 0} variant="secondary" onPress={exportCsv}>
              <ArrowDownToLine className="size-4" />
              Export
            </Button>
          ) : null}
          <Button onPress={() => openForm(null)}>
            <Plus className="size-4" />
            Add trip
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-white p-3 sm:p-4">
        <SearchField className="w-full sm:w-64" value={query} onChange={setQuery}>
          <Label>Search</Label>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="POC, facilitator, place, village…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <FilterSelect
          allLabel="All statuses"
          className={FILTER_WIDTH}
          label="Status"
          options={VISIT_STATUSES}
          value={status}
          onChange={setStatus}
        />
        <FilterSelect allLabel="All types"
          className={FILTER_WIDTH} label="Visit type" options={PROGRAM_CATEGORIES} value={program} onChange={setProgram} />
        <FilterSelect
          allLabel="All villages"
          className={FILTER_WIDTH}
          label="Village"
          options={reference.villages.map((v) => ({ id: v.id, label: v.name }))}
          value={villageId}
          onChange={setVillageId}
        />
        <FilterSelect
          allLabel="All facilitators"
          className={FILTER_WIDTH}
          label="Facilitator"
          options={reference.facilitators.map((f) => ({
            id: f.id,
            label: f.is_active ? f.name : `${f.name} (inactive)`,
          }))}
          value={facilitatorId}
          onChange={setFacilitatorId}
        />
        <DateRangeFilter value={dateRange} onChange={changeDateRange} />
        {filtersActive ? (
          <Button variant="ghost" onPress={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {filtersActive ? (
        <p className="-mt-2 text-sm text-muted">
          {filtered.length} of {visits.length} trip{visits.length === 1 ? "" : "s"} match these filters.
        </p>
      ) : null}

      {view === "calendar" ? (
        <VisitsCalendar
          month={month}
          reference={reference}
          today={today}
          visits={filtered}
          onAddVisit={(date) => openForm(null, date)}
          onMonthChange={setMonth}
          onOpenVisit={openDetail}
        />
      ) : visits.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-16 text-center">
          <p className="text-sm font-medium">No trips yet</p>
          <p className="max-w-md text-sm text-muted">
            Add a trip, attach its villages and guests, and the WhatsApp agent can answer guests&apos; questions
            about it and send the after-trip messages.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
          No trips match these filters.
        </p>
      ) : (
        <>
        {/* Phones: one card per trip; tapping it opens the same details as a table row. */}
        <ul aria-label="Trips" className="flex flex-col gap-2 md:hidden">
          {filtered.map((visit) => {
            const villages = visit.villageIds.map((id) => villageName.get(id) ?? "Unknown");
            const facilitators = facilitatorNames(visit);
            const contactName = visit.primaryGuest ? (visit.primaryGuest.name ?? "Unnamed contact") : visit.poc_name;
            const contactPhone = visit.primaryGuest?.phone ?? visit.poc_phone;
            return (
              <li
                key={visit.id}
                className="cursor-pointer rounded-xl border border-border/70 bg-white transition-colors active:bg-neutral-50"
                onClick={() => openDetail(visit)}
              >
                <button className="flex w-full flex-col gap-1 px-4 pt-3 text-left" type="button">
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{formatDateRange(visit.visit_date, visit.end_date)}</span>
                      <span className="block text-xs text-muted">{formatTimeRange(visit.start_time, visit.end_time)}</span>
                    </span>
                    <VisitStatusChip status={visit.status} />
                  </span>
                  <span className="text-sm">{visit.visit_type}</span>
                </button>
                <div className="flex flex-col gap-1 px-4 pb-3 pt-1 text-xs text-muted">
                  {contactName || contactPhone ? (
                    <p className="flex flex-wrap items-center gap-x-2">
                      <span className="text-sm text-foreground">{contactName ?? "Contact"}</span>
                      {contactPhone ? (
                        <a
                          className="tabular-nums text-accent underline-offset-2 hover:underline"
                          href={telHref(contactPhone)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {formatPhone(contactPhone)}
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                  {villages.length ? (
                    <div className="flex flex-wrap gap-1">
                      {villages.map((name, i) => (
                        <Chip key={visit.villageIds[i]} size="sm" variant="soft">
                          {name}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                  {facilitators ? <p>Facilitators: {facilitators}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <Table className="hidden md:block">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Trips"
              className="w-full min-w-[1120px]"
              onRowAction={handleRowAction}
            >
              <Table.Header>
                <Table.Column isRowHeader>Date</Table.Column>
                <Table.Column>Trip</Table.Column>
                <Table.Column>Primary POC</Table.Column>
                <Table.Column>Facilitator</Table.Column>
                <Table.Column>Group</Table.Column>
                <Table.Column>Headcount</Table.Column>
                <Table.Column>Villages</Table.Column>
                <Table.Column>Invoice</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column className="w-14 text-right">
                  <span className="sr-only">Actions</span>
                </Table.Column>
              </Table.Header>
              <Table.Body>
                {filtered.map((visit) => (
                  <Table.Row
                    key={visit.id}
                    className="cursor-pointer"
                    id={visit.id}
                    textValue={`${formatDateRange(visit.visit_date, visit.end_date)} ${visit.visit_type}`}
                  >
                    <Table.Cell className="whitespace-nowrap font-medium">
                      {formatDateRange(visit.visit_date, visit.end_date)}
                      <span className="block text-xs font-normal text-muted">
                        {formatTimeRange(visit.start_time, visit.end_time)}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      {visit.visit_type}
                      {visit.booking_channel ? (
                        <span className="block text-xs text-muted">{bookingChannelLabel(visit.booking_channel)}</span>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell>
                      {visit.primaryGuest ? (
                        <>
                          <span className="block max-w-[200px] truncate">
                            {visit.primaryGuest.name ?? "Unnamed contact"}
                          </span>
                          <span className="block whitespace-nowrap text-xs tabular-nums text-muted">
                            {formatPhone(visit.primaryGuest.phone)}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="max-w-[200px]">
                      {facilitatorNames(visit) || <span className="text-muted">—</span>}
                    </Table.Cell>
                    <Table.Cell>
                      <span className="block max-w-[200px] truncate">
                        {visit.visitor_category ? (
                          visitorCategoryLabel(visit.visitor_category)
                        ) : (
                          (visit.visitor_group ?? <span className="text-muted">—</span>)
                        )}
                      </span>
                      {visit.source ? (
                        <span className="block max-w-[200px] truncate text-xs text-muted">{visit.source}</span>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">{visit.headcount ?? <span className="text-muted">—</span>}</Table.Cell>
                    <Table.Cell>
                      <div className="flex max-w-[200px] flex-wrap gap-1">
                        {visit.villageIds.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          visit.villageIds.map((id) => (
                            <Chip key={id} size="sm" variant="soft">
                              {villageName.get(id) ?? "Unknown"}
                            </Chip>
                          ))
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <TripInvoicesCell
                        taxInvoices={visit.taxInvoices}
                        onAdd={() =>
                          setInvoiceTrip({
                            id: visit.id,
                            label: [
                              formatDateRange(visit.visit_date, visit.end_date),
                              visit.visit_type,
                              visit.primaryGuest?.name ?? visit.source,
                            ]
                              .filter(Boolean)
                              .join(" · "),
                          })
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <VisitStatusChip status={visit.status} />
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <VisitActionsMenu
                        visit={visit}
                        onEdit={() => openForm(visit)}
                        onGuests={() => guestsModal.open(visit)}
                        onMessages={() => messaging.open(visit)}
                        onStatusChange={(next) => handleStatusChange(visit, next)}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
        </>
      )}

      <TaxInvoiceDialog
        trip={invoiceTrip}
        onClose={() => setInvoiceTrip(null)}
        onSaved={() => {
          setInvoiceTrip(null);
          toast.success("Tax invoice added.");
          router.refresh();
        }}
      />

      <VisitDetailPanel
        isOpen={isDetailOpen}
        reference={reference}
        view={detailView}
        visit={detailVisit}
        onStatusChange={handleStatusChange}
        onViewChange={changeDetailView}
        onEdit={(visit) => openForm(visit, visit.visit_date ?? today)}
        onGuests={(visit) => {
          setIsDetailOpen(false);
          guestsModal.open(visit);
        }}
        onMessages={(visit) => {
          setIsDetailOpen(false);
          messaging.open(visit);
        }}
        onOpenChange={(open) => {
          setIsDetailOpen(open);
          // Drop a ?visit= deep link once it has been looked at, so a reload doesn't reopen it.
          if (!open && window.location.search.includes("visit=")) {
            window.history.replaceState(null, "", `/trips?view=${view}`);
          }
        }}
      />
      <VisitFormModal
        defaultDate={formDate}
        isOpen={isFormOpen}
        reference={reference}
        visit={editing}
        onOpenChange={setIsFormOpen}
        onSaved={(created) => {
          setIsFormOpen(false);
          router.refresh();
          // A new visit goes straight on to its guest list.
          if (created) guestsModal.openForNewVisit(created);
        }}
      />
      <VisitMessagingModal
        data={messaging.data}
        isOpen={messaging.isOpen}
        reload={messaging.reload}
        templates={messaging.templates}
        visit={messaging.visit}
        onOpenChange={messaging.setIsOpen}
      />
      <VisitGuestsModal
        guests={guestsModal.guests}
        isOpen={guestsModal.isOpen}
        justCreated={guestsModal.justCreated}
        reload={guestsModal.reload}
        visit={guestsModal.visit}
        onOpenChange={guestsModal.setIsOpen}
      />
    </div>
  );
}
