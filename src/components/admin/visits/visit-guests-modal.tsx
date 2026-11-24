"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, Comment, Copy, Plus, Star, StarFill, TrashBin, Xmark } from "@gravity-ui/icons";
import {
  AlertDialog,
  Button,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Table,
  Tabs,
  TextField,
  toast,
} from "@heroui/react";
import {
  addNewGuest,
  findLeadsByPhone,
  getVisitGuests,
  removeGuest,
  setGuestStatus,
  setPrimaryGuest,
} from "@/lib/actions/visits";
import { formatPhone } from "@/lib/mastra/phone";
import { DEFAULT_COUNTRY_CODE, GUEST_STATUSES } from "@/lib/visits/constants";
import { formatDateRange } from "@/lib/visits/time";
import type { LeadMatch, VisitGuestItem, VisitListItem } from "@/lib/visits/types";
import { GuestBulkUpload } from "./guest-bulk-upload";
import { PhoneField, joinPhone } from "./phone-field";

/**
 * Shared by the Trips and Calendar views. Guests are loaded in the click handler
 * that opens the modal (not in an effect), so the list is ready as it appears.
 */
export function useVisitGuests() {
  const [visit, setVisit] = useState<VisitListItem | null>(null);
  const [guests, setGuests] = useState<VisitGuestItem[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  async function open(next: VisitListItem) {
    setVisit(next);
    setJustCreated(false);
    setGuests(null);
    setIsOpen(true);
    setGuests(await getVisitGuests(next.id));
  }

  /** Straight after a visit is added: it has no guests yet, so nothing to load. */
  function openForNewVisit(next: VisitListItem) {
    setVisit(next);
    setJustCreated(true);
    setGuests([]);
    setIsOpen(true);
  }

  async function reload() {
    if (visit) setGuests(await getVisitGuests(visit.id));
  }

  return { visit, guests, isOpen, setIsOpen, open, openForNewVisit, justCreated, reload };
}

function initials(name: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Existing contacts matching the number being typed. */
function LeadMatchList({
  matches,
  activeIndex,
  onActiveChange,
  onPick,
}: {
  matches: LeadMatch[];
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onPick: (lead: LeadMatch) => void;
}) {
  return (
    <div
      className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-white shadow-lg"
      // Keep focus in the phone input while clicking an option.
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="border-b border-border/60 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-muted">
        Found in Leads — pick one to add them as a guest
      </p>
      <ul aria-label="Matching contacts" className="max-h-72 overflow-y-auto py-1" role="listbox">
        {matches.map((lead, index) => (
          <li
            key={lead.id}
            aria-disabled={lead.onVisit}
            aria-selected={index === activeIndex}
            className={`flex items-start gap-3 px-3 py-2 ${
              lead.onVisit ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            } ${index === activeIndex && !lead.onVisit ? "bg-accent/10" : lead.onVisit ? "" : "hover:bg-neutral-50"}`}
            role="option"
            onClick={() => {
              if (!lead.onVisit) onPick(lead);
            }}
            onMouseEnter={() => onActiveChange(index)}
          >
            <span
              aria-hidden
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent"
            >
              {initials(lead.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{lead.name ?? "Unnamed contact"}</span>
              <span className="block text-xs tabular-nums text-muted">{formatPhone(lead.phone)}</span>
              {lead.email ? <span className="block truncate text-xs text-muted">{lead.email}</span> : null}
              <span className="mt-1 flex flex-wrap gap-1">
                <Chip color="success" size="sm" variant="soft">
                  Existing contact
                </Chip>
                {lead.visitCount > 0 ? (
                  <Chip size="sm" variant="soft">
                    {lead.visitCount} trip{lead.visitCount === 1 ? "" : "s"}
                  </Chip>
                ) : null}
                {lead.onVisit ? (
                  <Chip color="warning" size="sm" variant="soft">
                    Already on this trip
                  </Chip>
                ) : null}
                {lead.codeMismatch ? (
                  <Chip color="warning" size="sm" variant="soft">
                    Different country code
                  </Chip>
                ) : null}
                {lead.optedOut ? (
                  <Chip color="danger" size="sm" variant="soft">
                    Opted out
                  </Chip>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddGuestPanel({
  visit,
  onAdded,
  onClose,
}: {
  visit: VisitListItem;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<string>("single");
  const [name, setName] = useState("");
  const [phoneCode, setPhoneCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Remounted after each add so the form comes back empty for the next guest.
  const [formKey, setFormKey] = useState(0);

  // Lookup of the typed number against Leads.
  const [matches, setMatches] = useState<LeadMatch[]>([]);
  const [lookup, setLookup] = useState<"idle" | "searching" | "done">("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState<LeadMatch | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest lookup may update the list (responses can arrive out of order).
  const searchSeq = useRef(0);

  function lookupPhone(code: string, number: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const seq = ++searchSeq.current;
    setSelected(null);
    setActiveIndex(-1);
    if (number.replace(/\D/g, "").replace(/^0+/, "").length < 3) {
      setMatches([]);
      setLookup("idle");
      setIsOpen(false);
      return;
    }
    setLookup("searching");
    searchTimer.current = setTimeout(async () => {
      const found = await findLeadsByPhone(visit.id, code, number);
      if (seq !== searchSeq.current) return;
      setMatches(found);
      setLookup("done");
      setIsOpen(found.length > 0);
    }, 250);
  }

  function handlePick(lead: LeadMatch) {
    setSelected(lead);
    setName(lead.name ?? "");
    setEmail(lead.email ?? "");
    setIsOpen(false);
    setError(null);
  }

  function resetForm() {
    searchSeq.current++;
    setSelected(null);
    setMatches([]);
    setLookup("idle");
    setIsOpen(false);
    setActiveIndex(-1);
    setName("");
    setPhoneNumber("");
    setEmail("");
    setFormKey((k) => k + 1);
  }

  function handlePhoneKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || matches.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + matches.length) % matches.length);
    } else if (e.key === "Enter" && activeIndex >= 0 && !matches[activeIndex].onVisit) {
      e.preventDefault();
      handlePick(matches[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setIsAdding(true);
    setError(null);
    // A picked contact is sent with its own stored number; the server reuses that lead (it keeps
    // its name, and only a missing name or email is filled in). Anyone else is saved to Leads.
    const result = await addNewGuest(visit.id, {
      name,
      phone: selected ? selected.phone : joinPhone(phoneCode, phoneNumber),
      email,
    });
    setIsAdding(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast.success(`${name.trim()} added${selected ? "" : " and saved to Leads"}`);
    resetForm();
    await onAdded();
  }

  const typedDigits = phoneNumber.replace(/\D/g, "").replace(/^0+/, "");

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-neutral-50/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Add guests</p>
        <Button isIconOnly aria-label="Close" size="sm" variant="ghost" onPress={onClose}>
          <Xmark className="size-4" />
        </Button>
      </div>
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="How to add">
            <Tabs.Tab id="single">
              One guest
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="bulk">
              Bulk upload
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel className="pt-4" id="single">
          <form key={formKey} className="flex flex-col gap-3" onSubmit={handleAdd}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div
                className="relative sm:col-span-2"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsOpen(false);
                }}
                onFocus={() => {
                  if (matches.length > 0 && !selected) setIsOpen(true);
                }}
                onKeyDown={handlePhoneKeyDown}
              >
                <PhoneField
                  isRequired
                  code={phoneCode}
                  label="WhatsApp number"
                  number={phoneNumber}
                  onCodeChange={(code) => {
                    setPhoneCode(code);
                    lookupPhone(code, phoneNumber);
                  }}
                  onNumberChange={(number) => {
                    setPhoneNumber(number);
                    lookupPhone(phoneCode, number);
                  }}
                />
                <p aria-live="polite" className="sr-only">
                  {isOpen ? `${matches.length} existing contact${matches.length === 1 ? "" : "s"} found` : ""}
                </p>
                {isOpen ? (
                  <LeadMatchList
                    activeIndex={activeIndex}
                    matches={matches}
                    onActiveChange={setActiveIndex}
                    onPick={handlePick}
                  />
                ) : null}
                {selected ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-success">
                    <CircleCheck className="size-3.5" />
                    Existing contact from Leads: {selected.name ?? formatPhone(selected.phone)}. Their details are
                    kept.
                  </p>
                ) : lookup === "done" && matches.length === 0 && typedDigits.length >= 8 ? (
                  <p className="mt-1 text-xs text-muted">
                    No existing contact with this number — they will be saved to Leads as a new contact.
                  </p>
                ) : null}
              </div>
              <TextField isReadOnly={Boolean(selected?.name)} isRequired value={name} onChange={setName}>
                <Label>Name</Label>
                <Input placeholder="Guest name" />
              </TextField>
              <TextField isReadOnly={Boolean(selected?.email)} type="email" value={email} onChange={setEmail}>
                <Label>Email (optional)</Label>
                <Input placeholder="name@example.com" />
              </TextField>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                Every guest is saved to Leads. The first guest added becomes the primary POC.
              </p>
              <Button isPending={isAdding} type="submit">
                <Plus className="size-4" />
                Add guest
              </Button>
            </div>
          </form>
        </Tabs.Panel>

        <Tabs.Panel className="pt-4" id="bulk">
          <GuestBulkUpload visitId={visit.id} onImported={onAdded} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function GuestsBody({
  visit,
  guests,
  reload,
  justCreated,
}: {
  visit: VisitListItem;
  guests: VisitGuestItem[] | null;
  reload: () => Promise<void>;
  justCreated: boolean;
}) {
  const router = useRouter();
  const [isAddOpen, setIsAddOpen] = useState(justCreated);
  // The guest whose remove button was pressed, waiting for confirmation.
  const [removing, setRemoving] = useState<VisitGuestItem | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  async function afterChange(result: { error?: string }) {
    if (result.error) {
      toast.danger(result.error);
      return false;
    }
    await reload();
    router.refresh();
    return true;
  }

  async function copyFeedbackLink(guest: VisitGuestItem) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}/fb/${guest.feedbackToken}`);
      toast.success("Feedback link copied");
    } catch {
      toast.danger("Couldn't copy the link — your browser blocked clipboard access.");
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setIsRemoving(true);
    const removed = await afterChange(await removeGuest(removing.id));
    setIsRemoving(false);
    if (removed) setRemoving(null);
  }

  async function changePrimary(guest: VisitGuestItem) {
    if (await afterChange(await setPrimaryGuest(visit.id, guest.id))) {
      toast.success(`${guest.name ?? "Contact"} is now the primary POC`);
    }
  }

  const count = guests?.length ?? 0;
  const primaryGuest = guests?.find((g) => g.isPrimary) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {justCreated ? (
        <div className="rounded-2xl bg-success/10 px-4 py-3 text-sm">
          <p className="font-medium text-success">Trip added.</p>
          <p className="text-muted">
            Add the guest list now, or skip and add guests later from the Guests button on the trip.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {guests === null ? "Guests" : `${count} guest${count === 1 ? "" : "s"}`}
            <span className="font-normal text-muted"> · headcount {visit.headcount ?? "not set"}</span>
          </p>
          <p className="text-xs text-muted">
            Guests marked invited or attended get the after-trip WhatsApp messages.
          </p>
        </div>
        {!isAddOpen ? (
          <Button onPress={() => setIsAddOpen(true)}>
            <Plus className="size-4" />
            Add guest
          </Button>
        ) : null}
      </div>

      {isAddOpen ? (
        <AddGuestPanel
          visit={visit}
          onAdded={async () => {
            await reload();
            router.refresh();
          }}
          onClose={() => setIsAddOpen(false)}
        />
      ) : null}

      {count > 0 ? (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-neutral-50/60 p-4">
          <Select
            className="w-full sm:w-72"
            placeholder="Select primary POC"
            value={primaryGuest?.id ?? null}
            onChange={async (key) => {
              const next = guests?.find((g) => g.id === String(key));
              if (next && !next.isPrimary) await changePrimary(next);
            }}
          >
            <Label>Primary POC</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {(guests ?? []).map((g) => (
                  <ListBox.Item key={g.id} id={g.id} textValue={g.name ?? g.phone}>
                    {g.name ?? "Unnamed contact"} · {formatPhone(g.phone)}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <p className="min-w-0 flex-1 text-xs text-muted">
            {primaryGuest
              ? "The contact shown for this trip on Trips. Pick another guest to replace them."
              : "No primary POC yet — pick the guest who is the main contact for this trip."}
          </p>
        </div>
      ) : null}

      <Table variant="primary">
        <Table.ScrollContainer>
          <Table.Content aria-label="Guests" className="w-full min-w-[680px]">
            <Table.Header>
              <Table.Column isRowHeader>Guest</Table.Column>
              <Table.Column>WhatsApp</Table.Column>
              <Table.Column className="w-40">Status</Table.Column>
              <Table.Column>Chat</Table.Column>
              <Table.Column className="w-32 text-right">
                <span className="sr-only">Actions</span>
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
                  {guests === null ? (
                    "Loading guests…"
                  ) : (
                    <>
                      <span>No guests yet. Add them so they receive messages about this trip.</span>
                      {!isAddOpen ? (
                        <Button size="sm" variant="secondary" onPress={() => setIsAddOpen(true)}>
                          <Plus className="size-4" />
                          Add guest
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            >
              {(guests ?? []).map((guest) => (
                <Table.Row key={guest.id} id={guest.id}>
                  <Table.Cell>
                    <span className="block font-medium">{guest.name ?? "Unnamed contact"}</span>
                    {guest.email ? <span className="block text-xs text-muted">{guest.email}</span> : null}
                    {guest.isPrimary || guest.optedOut || guest.needsHuman ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {guest.isPrimary ? (
                          <Chip color="accent" size="sm" variant="soft">
                            Primary POC
                          </Chip>
                        ) : null}
                        {guest.optedOut ? (
                          <Chip color="danger" size="sm" variant="soft">
                            Opted out
                          </Chip>
                        ) : null}
                        {guest.needsHuman ? (
                          <Chip color="warning" size="sm" variant="soft">
                            Needs a person
                          </Chip>
                        ) : null}
                      </span>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap tabular-nums">{formatPhone(guest.phone)}</Table.Cell>
                  <Table.Cell>
                    <Select
                      aria-label={`Status for ${guest.name ?? guest.phone}`}
                      className="w-36"
                      value={guest.status}
                      onChange={async (key) => {
                        if (key) await afterChange(await setGuestStatus(guest.id, String(key)));
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {GUEST_STATUSES.map((s) => (
                            <ListBox.Item key={s.id} id={s.id} textValue={s.label}>
                              {s.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </Table.Cell>
                  <Table.Cell>
                    {guest.conversationId ? (
                      <Link
                        className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
                        href={`/inbox?c=${guest.conversationId}`}
                      >
                        <Comment className="size-4" />
                        Open chat
                      </Link>
                    ) : (
                      <span className="text-xs text-muted">No chat yet</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    <Button
                      isIconOnly
                      aria-label={
                        guest.isPrimary
                          ? `${guest.name ?? guest.phone} is the primary POC`
                          : `Make ${guest.name ?? guest.phone} the primary POC`
                      }
                      isDisabled={guest.isPrimary}
                      size="sm"
                      variant="ghost"
                      onPress={() => changePrimary(guest)}
                    >
                      {guest.isPrimary ? <StarFill className="size-4 text-accent" /> : <Star className="size-4" />}
                    </Button>
                    {visit.feedback_form_id ? (
                      <Button
                        isIconOnly
                        aria-label={`Copy feedback link for ${guest.name ?? guest.phone}`}
                        size="sm"
                        variant="ghost"
                        onPress={() => copyFeedbackLink(guest)}
                      >
                        <Copy className="size-4" />
                      </Button>
                    ) : null}
                    <Button
                      isIconOnly
                      aria-label={`Remove ${guest.name ?? guest.phone}`}
                      size="sm"
                      variant="ghost"
                      onPress={() => setRemoving(guest)}
                    >
                      <TrashBin className="size-4 text-danger" />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <AlertDialog isOpen={removing !== null} onOpenChange={(open) => !open && !isRemoving && setRemoving(null)}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[400px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Remove {removing?.name ?? (removing ? formatPhone(removing.phone) : "guest")}?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>They are taken off this trip&apos;s guest list. The contact itself stays in Leads.</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button isPending={isRemoving} variant="danger" onPress={confirmRemove}>
                  Remove guest
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}

export function VisitGuestsModal({
  visit,
  guests,
  reload,
  isOpen,
  onOpenChange,
  justCreated = false,
}: {
  visit: VisitListItem | null;
  guests: VisitGuestItem[] | null;
  reload: () => Promise<void>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened straight after the visit was added — shows a prompt and a skip button. */
  justCreated?: boolean;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container scroll="outside">
        <Modal.Dialog className="sm:max-w-4xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {justCreated ? "Add guest list" : "Guests"}
              {visit ? ` — ${visit.visit_type}, ${formatDateRange(visit.visit_date, visit.end_date)}` : ""}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {visit ? (
              <GuestsBody key={visit.id} guests={guests} justCreated={justCreated} reload={reload} visit={visit} />
            ) : null}
          </Modal.Body>
          {justCreated ? (
            <Modal.Footer>
              <Button slot="close" variant={guests && guests.length > 0 ? "primary" : "tertiary"}>
                {guests && guests.length > 0 ? "Done" : "Skip for now"}
              </Button>
            </Modal.Footer>
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
