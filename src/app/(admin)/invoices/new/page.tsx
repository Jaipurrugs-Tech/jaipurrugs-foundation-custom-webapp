import Link from "next/link";
import { InvoiceEditor } from "@/components/admin/invoices/invoice-editor";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadInvoiceEditorData } from "@/lib/invoices/editor-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ visit?: string }> }) {
  await requireActiveTeamMember();
  const params = await searchParams;
  const visitId = params.visit && UUID_PATTERN.test(params.visit) ? params.visit : null;
  const supabase = await createClient();
  const data = await loadInvoiceEditorData(supabase, visitId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link className="text-sm text-muted hover:text-foreground" href={visitId ? `/trips?visit=${visitId}` : "/invoices"}>
          {visitId ? "← Back to trip" : "← Proforma invoices"}
        </Link>
        <h1 className="text-xl font-semibold">New proforma invoice</h1>
      </div>
      <InvoiceEditor {...data} initialVisitId={visitId} invoice={null} />
    </div>
  );
}
