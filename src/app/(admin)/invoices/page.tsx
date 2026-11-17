import { InvoicesWorkspace } from "@/components/admin/invoices/invoices-workspace";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { visitOptionLabel } from "@/lib/invoices/queries";
import type { InvoiceListItem } from "@/lib/invoices/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const INVOICE_LIMIT = 1000;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireActiveTeamMember();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: invoices }, { data: terms }, { data: settings }] = await Promise.all([
    supabase
      .from("proforma_invoices")
      .select(
        "id, pi_number, pi_date, status, visit_id, billing_name, guests, taxable_total, grand_total, updated_at, visits(visit_date, program_category, source, headcount)",
      )
      .order("pi_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(INVOICE_LIMIT),
    supabase.from("invoice_terms").select("*").order("position").order("created_at"),
    supabase.from("invoice_settings").select("*").maybeSingle(),
  ]);

  // A short-lived signed URL, only to show the uploaded QR code on the Settings tab.
  let qrPreviewUrl: string | null = null;
  if (settings?.upi_qr_path) {
    const { data } = await supabase.storage.from("invoice-assets").createSignedUrl(settings.upi_qr_path, 600);
    qrPreviewUrl = data?.signedUrl ?? null;
  }

  const items: InvoiceListItem[] = (invoices ?? []).map(({ visits, ...invoice }) => ({
    ...invoice,
    visitLabel: visits ? visitOptionLabel(visits) : null,
  }));

  const tab = params.tab === "terms" || params.tab === "settings" ? params.tab : "invoices";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Proforma invoices</h1>
        <p className="text-sm text-muted">
          Raise a PI for a trip from its services, group size and slabs, then download it as a PDF. Issued and paid
          PIs are the trip&apos;s Rural Experience revenue on Trips and the dashboard.
        </p>
      </div>
      <InvoicesWorkspace
        initialTab={tab}
        invoices={items}
        qrPreviewUrl={qrPreviewUrl}
        settings={settings ?? null}
        terms={terms ?? []}
      />
    </div>
  );
}
