import { ExpensesManager } from "@/components/admin/finance/expenses-manager";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadExpenses, loadVillageOptions, loadVisitOptions } from "@/lib/finance/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function FinanceExpensesPage() {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const [visitOptions, villageOptions] = await Promise.all([loadVisitOptions(supabase), loadVillageOptions(supabase)]);
  const expenses = await loadExpenses(supabase, visitOptions, villageOptions);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Expenses</h1>
        <p className="text-sm text-muted">
          The foundation&apos;s costs, optionally linked to a trip or village, with receipts kept privately.
        </p>
      </div>
      <ExpensesManager expenses={expenses} villageOptions={villageOptions} visitOptions={visitOptions} />
    </div>
  );
}
