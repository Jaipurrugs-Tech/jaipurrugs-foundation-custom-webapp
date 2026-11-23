import { PaymentsManager } from "@/components/admin/finance/payments-manager";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadPaymentInvoices, loadPayments } from "@/lib/finance/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function FinancePaymentsPage() {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const [invoices, payments] = await Promise.all([loadPaymentInvoices(supabase), loadPayments(supabase)]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Payments received</h1>
        <p className="text-sm text-muted">
          Record money received against issued proforma invoices. A PI turns Paid once payments cover its total
          (incl. GST), and back to Issued if a payment is removed.
        </p>
      </div>
      <PaymentsManager invoices={invoices} payments={payments} />
    </div>
  );
}
