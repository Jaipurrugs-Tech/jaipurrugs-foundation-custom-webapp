import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceEditor } from "@/components/admin/invoices/invoice-editor";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadInvoiceEditorData } from "@/lib/invoices/editor-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireActiveTeamMember();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: invoice }, { data: items }] = await Promise.all([
    supabase.from("proforma_invoices").select("*").eq("id", id).maybeSingle(),
    supabase.from("proforma_invoice_items").select("*").eq("invoice_id", id).order("position"),
  ]);
  if (!invoice) notFound();
  const data = await loadInvoiceEditorData(supabase, invoice.visit_id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link className="text-sm text-muted hover:text-foreground" href="/invoices">
          ← Proforma invoices
        </Link>
        <h1 className="text-xl font-semibold">{invoice.pi_number}</h1>
      </div>
      {/* Keyed on the PI, so navigating between PIs resets the editor (its own saves don't). */}
      <InvoiceEditor
        key={invoice.id}
        {...data}
        initialVisitId={invoice.visit_id}
        invoice={{ ...invoice, items: items ?? [] }}
      />
    </div>
  );
}
