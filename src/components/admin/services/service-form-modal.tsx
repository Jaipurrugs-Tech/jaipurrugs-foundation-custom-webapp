"use client";

import { useState } from "react";
import { Plus, TrashBin } from "@gravity-ui/icons";
import {
  Autocomplete,
  Button,
  Checkbox,
  CheckboxGroup,
  Description,
  EmptyState,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  Tag,
  TagGroup,
  TextArea,
  TextField,
  useFilter,
  type Key,
} from "@heroui/react";
import { OptionSelect } from "@/components/admin/invoices/option-select";
import { saveService } from "@/lib/actions/services";
import { formatRupees, priceWithGst } from "@/lib/invoices/calc";
import {
  DEFAULT_CUSTOM_PRICING_ABOVE,
  DEFAULT_GST_RATE,
  DISCOUNT_TYPES,
  PRICING_UNITS,
  pricingUnitShort,
} from "@/lib/invoices/constants";
import { serviceSchema, type ServiceInput } from "@/lib/invoices/schemas";
import type { ServiceItem } from "@/lib/invoices/types";
import { PROGRAM_CATEGORIES, VISITOR_CATEGORIES } from "@/lib/visits/constants";
import type { VillageOption } from "@/lib/visits/types";

const numberToText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

type SlabDraft = {
  key: string;
  minHeadcount: string;
  maxHeadcount: string;
  discountType: string;
  discountValue: string;
  freeGuides: string;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Multi-select of the locations (villages) a service runs in. */
function LocationsField({
  villages,
  value,
  onChange,
}: {
  villages: VillageOption[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { contains } = useFilter({ sensitivity: "base" });
  // Inactive locations are only listed while chosen, so they can still be removed.
  const options = villages.filter((v) => v.is_active || value.includes(v.id));
  const selected = value.map((id) => villages.find((v) => v.id === id)).filter((v): v is VillageOption => Boolean(v));

  return (
    <Autocomplete
      allowsEmptyCollection
      fullWidth
      placeholder="Any location"
      selectionMode="multiple"
      value={value}
      onChange={(keys) => onChange(((keys as Key[] | null) ?? []).map(String))}
    >
      <Label>Locations served</Label>
      <Autocomplete.Trigger>
        <Autocomplete.Value>
          {({ defaultChildren, isPlaceholder }) =>
            isPlaceholder || selected.length === 0 ? (
              defaultChildren
            ) : (
              <TagGroup
                aria-label="Chosen locations"
                size="sm"
                onRemove={(keys) => onChange(value.filter((id) => !keys.has(id)))}
              >
                <TagGroup.List>
                  {selected.map((village) => (
                    <Tag key={village.id} id={village.id} textValue={village.name}>
                      {village.name}
                      {!village.is_active ? " (inactive)" : ""}
                    </Tag>
                  ))}
                </TagGroup.List>
              </TagGroup>
            )
          }
        </Autocomplete.Value>
        <Autocomplete.ClearButton />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover>
        <Autocomplete.Filter filter={contains}>
          <SearchField autoFocus aria-label="Search locations" name="service-location-search" variant="secondary">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search locations" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <ListBox renderEmptyState={() => <EmptyState>No matching location. Add it on the Villages page.</EmptyState>}>
            {options.map((village) => (
              <ListBox.Item key={village.id} id={village.id} textValue={village.name}>
                {village.name}
                {!village.is_active ? <span className="text-muted"> (inactive)</span> : null}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>
  );
}

function CheckboxList({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  options: readonly { id: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <CheckboxGroup value={value} onChange={onChange}>
      <Label>{label}</Label>
      <Description>{hint}</Description>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <Checkbox key={option.id} value={option.id}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {option.label}
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
    </CheckboxGroup>
  );
}

function SlabsEditor({
  slabs,
  onChange,
  customAbove,
  unit,
}: {
  slabs: SlabDraft[];
  onChange: (slabs: SlabDraft[]) => void;
  customAbove: number;
  unit: string;
}) {
  function update(key: string, changes: Partial<SlabDraft>) {
    onChange(slabs.map((slab) => (slab.key === key ? { ...slab, ...changes } : slab)));
  }

  function addSlab() {
    const last = slabs.reduce((max, slab) => Math.max(max, Number(slab.maxHeadcount) || 0), 0);
    const from = Math.min(last + 1, customAbove);
    onChange([
      ...slabs,
      {
        key: crypto.randomUUID(),
        minHeadcount: String(from),
        maxHeadcount: String(Math.min(from + 9, customAbove)),
        discountType: "percent",
        discountValue: "0",
        freeGuides: "0",
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      {slabs.length > 0 ? (
        <div className="hidden grid-cols-[5rem_5rem_9rem_1fr_6rem_auto] gap-2 px-0.5 text-xs font-medium text-muted sm:grid">
          <span>From</span>
          <span>To</span>
          <span>Discount</span>
          <span>Value</span>
          <span>Free guides</span>
          <span className="w-9" />
        </div>
      ) : null}
      {slabs.map((slab) => (
        <div key={slab.key} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[5rem_5rem_9rem_1fr_6rem_auto]">
          <TextField aria-label="From headcount" value={slab.minHeadcount} onChange={(v) => update(slab.key, { minHeadcount: v })}>
            <Input min={1} type="number" />
          </TextField>
          <TextField aria-label="To headcount" value={slab.maxHeadcount} onChange={(v) => update(slab.key, { maxHeadcount: v })}>
            <Input max={customAbove} min={1} type="number" />
          </TextField>
          <OptionSelect
            hideLabel
            label="Discount type"
            options={DISCOUNT_TYPES.map((d) => ({ id: d.id, label: d.id === "amount" ? `₹ off per ${unit}` : d.label }))}
            value={slab.discountType}
            onChange={(v) => update(slab.key, { discountType: v || "percent" })}
          />
          <TextField aria-label="Discount value" value={slab.discountValue} onChange={(v) => update(slab.key, { discountValue: v })}>
            <Input min={0} placeholder="0" step="0.01" type="number" />
          </TextField>
          <TextField aria-label="Free guides" value={slab.freeGuides} onChange={(v) => update(slab.key, { freeGuides: v })}>
            <Input min={0} type="number" />
          </TextField>
          <Button
            isIconOnly
            aria-label="Remove slab"
            type="button"
            variant="ghost"
            onPress={() => onChange(slabs.filter((s) => s.key !== slab.key))}
          >
            <TrashBin className="size-4 text-danger" />
          </Button>
        </div>
      ))}
      <Button className="self-start" size="sm" type="button" variant="secondary" onPress={addSlab}>
        <Plus className="size-4" />
        Add slab
      </Button>
    </div>
  );
}

function ServiceForm({
  service,
  villages,
  onSaved,
}: {
  service: ServiceItem | null;
  villages: VillageOption[];
  onSaved: () => void;
}) {
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [sacCode, setSacCode] = useState(service?.sac_code ?? "");
  const [pricingUnit, setPricingUnit] = useState<string>(service?.pricing_unit ?? "per_person");
  const [baseRate, setBaseRate] = useState(numberToText(service?.base_rate));
  const [gstRate, setGstRate] = useState(numberToText(service?.gst_rate ?? DEFAULT_GST_RATE));
  const [extraGuideRate, setExtraGuideRate] = useState(numberToText(service?.extra_guide_rate));
  const [customAbove, setCustomAbove] = useState(numberToText(service?.custom_pricing_above ?? DEFAULT_CUSTOM_PRICING_ABOVE));
  const [villageIds, setVillageIds] = useState<string[]>(service?.villageIds ?? []);
  const [programs, setPrograms] = useState<string[]>(service?.program_categories ?? []);
  const [visitorTypes, setVisitorTypes] = useState<string[]>(service?.visitor_categories ?? []);
  const [slabs, setSlabs] = useState<SlabDraft[]>(() =>
    [...(service?.slabs ?? [])]
      .sort((a, b) => a.min_headcount - b.min_headcount)
      .map((slab) => ({
        key: slab.id,
        minHeadcount: String(slab.min_headcount),
        maxHeadcount: String(slab.max_headcount),
        discountType: slab.discount_type,
        discountValue: String(slab.discount_value),
        freeGuides: String(slab.free_guides),
      })),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const unit = pricingUnitShort(pricingUnit);
  const rateNumber = Number(baseRate);
  const gstNumber = Number(gstRate);
  const customAboveNumber = Number(customAbove) || DEFAULT_CUSTOM_PRICING_ABOVE;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: ServiceInput = {
      name,
      description,
      sacCode,
      pricingUnit: pricingUnit as ServiceInput["pricingUnit"],
      baseRate,
      gstRate,
      extraGuideRate,
      customPricingAbove: customAbove,
      programCategories: programs as ServiceInput["programCategories"],
      visitorCategories: visitorTypes as ServiceInput["visitorCategories"],
      villageIds,
      slabs: slabs.map((slab) => ({
        minHeadcount: slab.minHeadcount,
        maxHeadcount: slab.maxHeadcount,
        discountType: slab.discountType as "percent" | "amount",
        discountValue: slab.discountValue,
        freeGuides: slab.freeGuides,
      })),
    };
    const parsed = serviceSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setIsPending(true);
    setError(null);
    const result = await saveService(service?.id ?? null, input);
    setIsPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <Section title="Service">
        <TextField isRequired value={name} onChange={setName}>
          <Label>Name (as printed on the PI)</Label>
          <Input placeholder="e.g. Explore Rural Rajasthan: Craft, Food, Village Life" />
        </TextField>
        <TextField value={description} onChange={setDescription}>
          <Label>Description</Label>
          <TextArea placeholder="Internal description (optional)" rows={2} />
        </TextField>
      </Section>

      <Section title="Pricing" hint="The base amount is before GST. The PI adds GST on the total after discounts.">
        <div className="grid gap-4 sm:grid-cols-4">
          <OptionSelect isRequired label="Charged" options={PRICING_UNITS} value={pricingUnit} onChange={(v) => setPricingUnit(v || "per_person")} />
          <TextField isRequired value={baseRate} onChange={setBaseRate}>
            <Label>Base amount (₹)</Label>
            <Input min={0} placeholder="e.g. 4999" step="0.01" type="number" />
          </TextField>
          <TextField isRequired value={gstRate} onChange={setGstRate}>
            <Label>GST rate (%)</Label>
            <Input max={100} min={0} step="0.01" type="number" />
          </TextField>
          <TextField value={sacCode} onChange={setSacCode}>
            <Label>SAC / HSN</Label>
            <Input placeholder="e.g. 998555" />
          </TextField>
        </div>
        {baseRate !== "" && Number.isFinite(rateNumber) && Number.isFinite(gstNumber) ? (
          <p className="text-sm text-muted">
            Charged {formatRupees(rateNumber)} + {gstNumber}% GST ={" "}
            <span className="font-medium text-foreground">{formatRupees(priceWithGst(rateNumber, gstNumber))}</span> per{" "}
            {unit}.
          </p>
        ) : null}
      </Section>

      <Section title="Where and who" hint="Leave a list empty to offer the service everywhere / to everyone. The PI editor suggests matching services for a trip.">
        <LocationsField value={villageIds} villages={villages} onChange={setVillageIds} />
        <CheckboxList hint="The trip programs this service is sold on." label="Programs" options={PROGRAM_CATEGORIES} value={programs} onChange={setPrograms} />
        <CheckboxList hint="The visitor types it's offered to." label="Visitor types" options={VISITOR_CATEGORIES} value={visitorTypes} onChange={setVisitorTypes} />
      </Section>

      <Section
        title="Group slabs: discounts and free guides"
        hint={`Each slab is a headcount band. Its discount is applied per ${unit} and its free guides go on the PI. Groups larger than the custom-pricing headcount get no slab: the manager sets their discount and free guides on the PI.`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField isRequired value={customAbove} onChange={setCustomAbove}>
            <Label>Custom pricing above (guests)</Label>
            <Input min={1} type="number" />
            <Description>Usually 50.</Description>
          </TextField>
          <TextField value={extraGuideRate} onChange={setExtraGuideRate}>
            <Label>Rate per extra guide (₹)</Label>
            <Input min={0} placeholder="Same as base amount" step="0.01" type="number" />
            <Description>For guides beyond the free allowance.</Description>
          </TextField>
        </div>
        <SlabsEditor customAbove={customAboveNumber} slabs={slabs} unit={unit} onChange={setSlabs} />
      </Section>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button fullWidth isPending={isPending} type="submit">
        {service ? "Save changes" : "Add service"}
      </Button>
    </form>
  );
}

export function ServiceFormModal({
  service,
  villages,
  isOpen,
  onOpenChange,
  onSaved,
}: {
  service: ServiceItem | null;
  villages: VillageOption[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container scroll="outside">
        <Modal.Dialog className="sm:max-w-3xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{service ? "Edit service" : "Add service"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {/* Keyed so switching services resets the form. */}
            <ServiceForm key={service?.id ?? "new"} service={service} villages={villages} onSaved={onSaved} />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
