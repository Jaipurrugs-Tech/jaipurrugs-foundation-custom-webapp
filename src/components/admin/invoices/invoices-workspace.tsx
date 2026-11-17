"use client";

import { Tabs } from "@heroui/react";
import type { InvoiceListItem, InvoiceSettingsRow, InvoiceTermRow } from "@/lib/invoices/types";
import { InvoiceSettingsPanel } from "./invoice-settings-panel";
import { InvoiceTermsPanel } from "./invoice-terms-panel";
import { InvoicesTable } from "./invoices-table";

export function InvoicesWorkspace({
  initialTab,
  invoices,
  terms,
  settings,
  qrPreviewUrl,
}: {
  initialTab: string;
  invoices: InvoiceListItem[];
  terms: InvoiceTermRow[];
  settings: InvoiceSettingsRow | null;
  qrPreviewUrl: string | null;
}) {
  return (
    <Tabs defaultSelectedKey={initialTab} variant="secondary">
      <Tabs.ListContainer>
        <Tabs.List aria-label="Proforma invoices">
          <Tabs.Tab id="invoices">
            Invoices
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="terms">
            Terms &amp; conditions
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="settings">
            Settings
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel className="pt-6" id="invoices">
        <InvoicesTable invoices={invoices} />
      </Tabs.Panel>
      <Tabs.Panel className="pt-6" id="terms">
        <InvoiceTermsPanel terms={terms} />
      </Tabs.Panel>
      <Tabs.Panel className="pt-6" id="settings">
        {settings ? (
          <InvoiceSettingsPanel qrPreviewUrl={qrPreviewUrl} settings={settings} />
        ) : (
          <p className="text-sm text-danger">Invoice settings are missing. Apply the services &amp; invoices migration.</p>
        )}
      </Tabs.Panel>
    </Tabs>
  );
}
