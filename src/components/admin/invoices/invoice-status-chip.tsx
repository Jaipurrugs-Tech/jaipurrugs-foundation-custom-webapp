"use client";

import { ChevronDown } from "@gravity-ui/icons";
import { Button, Chip, Dropdown, Label } from "@heroui/react";
import { INVOICE_STATUSES, invoiceStatusColor, invoiceStatusLabel } from "@/lib/invoices/constants";

export function InvoiceStatusChip({ status }: { status: string }) {
  return (
    <Chip color={invoiceStatusColor(status)} size="sm" variant="soft">
      {invoiceStatusLabel(status)}
    </Chip>
  );
}

/** The status chip as a menu: pick another status to change it. */
export function InvoiceStatusMenu({ status, onChange }: { status: string; onChange: (status: string) => void }) {
  return (
    <Dropdown>
      <Button aria-label={`Status: ${invoiceStatusLabel(status)}. Change status`} className="h-auto gap-0.5 px-1 py-0.5" size="sm" variant="ghost">
        <InvoiceStatusChip status={status} />
        <ChevronDown className="size-3 text-muted" />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          selectedKeys={new Set([status])}
          selectionMode="single"
          onAction={(key) => {
            if (String(key) !== status) onChange(String(key));
          }}
        >
          {INVOICE_STATUSES.map((s) => (
            <Dropdown.Item key={s.id} id={s.id} textValue={s.label}>
              <Dropdown.ItemIndicator />
              <Label>{s.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
