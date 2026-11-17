"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { AlertDialog, Button, Chip, SearchField, Switch, Table, toast } from "@heroui/react";
import { deleteService, setServiceActive } from "@/lib/actions/services";
import {
  formatRupees,
  priceWithGst,
  slabDiscountLabel,
  slabRangeLabel,
  sortSlabs,
} from "@/lib/invoices/calc";
import { pricingUnitShort } from "@/lib/invoices/constants";
import type { ServiceItem } from "@/lib/invoices/types";
import { programLabel, visitorCategoryLabel } from "@/lib/visits/constants";
import type { VillageOption } from "@/lib/visits/types";
import { ServiceFormModal } from "./service-form-modal";

function ChipList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <span className="text-xs text-muted">{empty}</span>;
  return (
    <div className="flex max-w-56 flex-wrap gap-1">
      {items.map((item) => (
        <Chip key={item} size="sm" variant="soft">
          {item}
        </Chip>
      ))}
    </div>
  );
}

export function ServicesManager({ services, villages }: { services: ServiceItem[]; villages: VillageOption[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ServiceItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const villageName = useMemo(() => new Map(villages.map((v) => [v.id, v.name])), [villages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((service) =>
      [
        service.name,
        service.description ?? "",
        service.sac_code ?? "",
        ...service.villageIds.map((id) => villageName.get(id) ?? ""),
      ].some((text) => text.toLowerCase().includes(q)),
    );
  }, [services, query, villageName]);

  function openForm(service: ServiceItem | null) {
    setEditing(service);
    setIsFormOpen(true);
  }

  async function handleToggle(service: ServiceItem, isActive: boolean) {
    const result = await setServiceActive(service.id, isActive);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteService(pendingDelete.id);
    setIsDeleting(false);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField aria-label="Search services" className="w-72" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search services or locations…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Button onPress={() => openForm(null)}>
          <Plus className="size-4" />
          Add service
        </Button>
      </div>

      {services.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-16 text-center">
          <p className="text-sm font-medium">No services yet</p>
          <p className="max-w-md text-sm text-muted">
            Add what you charge for, e.g. &ldquo;Explore Rural Rajasthan: Craft, Food, Village Life&rdquo; at ₹4,999 per
            person + 18% GST, with group slabs for discounts and free guides.
          </p>
        </div>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Services" className="w-full min-w-[1080px]">
              <Table.Header>
                <Table.Column isRowHeader>Service</Table.Column>
                <Table.Column>Price</Table.Column>
                <Table.Column>Group slabs</Table.Column>
                <Table.Column>Locations</Table.Column>
                <Table.Column>Offered for</Table.Column>
                <Table.Column>Active</Table.Column>
                <Table.Column className="w-28 text-right">
                  <span className="sr-only">Actions</span>
                </Table.Column>
              </Table.Header>
              <Table.Body>
                {filtered.map((service) => {
                  const slabs = sortSlabs(service.slabs);
                  const unit = pricingUnitShort(service.pricing_unit);
                  return (
                    <Table.Row key={service.id}>
                      <Table.Cell className="max-w-72 align-top">
                        <span className="font-medium">{service.name}</span>
                        {service.description ? (
                          <span className="line-clamp-2 block text-xs text-muted">{service.description}</span>
                        ) : null}
                        {service.sac_code ? <span className="block text-xs text-muted">SAC {service.sac_code}</span> : null}
                      </Table.Cell>
                      <Table.Cell className="align-top tabular-nums">
                        <span className="block font-medium">
                          {formatRupees(service.base_rate)}
                          <span className="font-normal text-muted"> / {unit}</span>
                        </span>
                        <span className="block text-xs text-muted">
                          + {service.gst_rate}% GST = {formatRupees(priceWithGst(service.base_rate, service.gst_rate))}
                        </span>
                        {service.extra_guide_rate !== null ? (
                          <span className="block text-xs text-muted">
                            Extra guide {formatRupees(service.extra_guide_rate)}
                          </span>
                        ) : null}
                      </Table.Cell>
                      <Table.Cell className="align-top">
                        {slabs.length === 0 ? (
                          <span className="text-xs text-muted">No slabs</span>
                        ) : (
                          <ul className="flex flex-col gap-0.5 text-xs">
                            {slabs.map((slab) => (
                              <li key={slab.id} className="tabular-nums">
                                <span className="font-medium">{slabRangeLabel(slab)}</span>
                                <span className="text-muted">
                                  {" "}
                                  · {slabDiscountLabel(slab)} · {slab.free_guides} free guide
                                  {slab.free_guides === 1 ? "" : "s"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <span className="mt-1 block text-xs text-muted">
                          Over {service.custom_pricing_above}: set on the PI
                        </span>
                      </Table.Cell>
                      <Table.Cell className="align-top">
                        <ChipList
                          empty="Any location"
                          items={service.villageIds.map((id) => villageName.get(id) ?? "Removed location")}
                        />
                      </Table.Cell>
                      <Table.Cell className="align-top">
                        <div className="flex flex-col gap-1.5">
                          <ChipList empty="All programs" items={service.program_categories.map(programLabel)} />
                          <ChipList
                            empty="All visitor types"
                            items={service.visitor_categories.map((c) => visitorCategoryLabel(c))}
                          />
                        </div>
                      </Table.Cell>
                      <Table.Cell className="align-top">
                        <Switch
                          aria-label={`${service.name} active`}
                          isSelected={service.is_active}
                          onChange={(selected) => handleToggle(service, selected)}
                        >
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch>
                      </Table.Cell>
                      <Table.Cell className="text-right align-top">
                        <Button isIconOnly aria-label="Edit service" size="sm" variant="ghost" onPress={() => openForm(service)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          isIconOnly
                          aria-label="Delete service"
                          size="sm"
                          variant="ghost"
                          onPress={() => setPendingDelete(service)}
                        >
                          <TrashBin className="size-4 text-danger" />
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      {filtered.length === 0 && services.length > 0 ? (
        <p className="text-center text-sm text-muted">No services match.</p>
      ) : null}

      <ServiceFormModal
        isOpen={isFormOpen}
        service={editing}
        villages={villages}
        onOpenChange={setIsFormOpen}
        onSaved={() => {
          setIsFormOpen(false);
          router.refresh();
        }}
      />

      <AlertDialog isOpen={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[440px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Delete &ldquo;{pendingDelete?.name}&rdquo;?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  {pendingDelete?.usageCount
                    ? `It is on ${pendingDelete.usageCount} proforma invoice line${pendingDelete.usageCount === 1 ? "" : "s"}. Those PIs keep their own copy and won't change, but you may want to switch the service off instead.`
                    : "The service and its slabs are removed. Existing proforma invoices are not affected."}
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button isPending={isDeleting} variant="danger" onPress={handleDelete}>
                  Delete service
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
