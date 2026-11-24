import { TaxInvoicesManager } from "@/components/admin/finance/tax-invoices-manager";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadProformaBalances, loadTaxInvoices, loadVisitOptions } from "@/lib/finance/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FinanceInvoicesPage({ searchParams }: { searchParams: Promise<{ visit?: string }> }) {
  await requireActiveTeamMember();
  const { visit } = await searchParams;
  const supabase = await createClient();
  const visitOptions = await loadVisitOptions(supabase);
  const [proformas, taxInvoices] = await Promise.all([
    loadProformaBalances(supabase),
    loadTaxInvoices(supabase, visitOptions),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Tax invoices</h1>
        <p className="text-sm text-muted">
          Tax invoices for trips the client has paid for, as issued in your accounts, with their PDF. Each one shows on
          its trip in Trips. Link it to the proforma invoice it settles to keep that PI&apos;s balance up to date.
        </p>
      </div>
      <TaxInvoicesManager
        initialVisitId={visit && UUID_PATTERN.test(visit) ? visit : null}
        proformas={proformas}
        taxInvoices={taxInvoices}
        visitOptions={visitOptions}
      />
    </div>
  );
}
