import { PayoutsManager } from "@/components/admin/finance/payouts-manager";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadPayouts, loadPendingPayouts, loadVillageOptions, loadVisitOptions } from "@/lib/finance/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function FinancePayoutsPage() {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const [visitOptions, villageOptions] = await Promise.all([loadVisitOptions(supabase), loadVillageOptions(supabase)]);
  const [payouts, pending] = await Promise.all([
    loadPayouts(supabase, visitOptions, villageOptions),
    loadPendingPayouts(supabase, villageOptions),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Artisan payouts</h1>
        <p className="text-sm text-muted">
          What each completed trip owes artisan families (its &ldquo;amount to artisans&rdquo;) and the payouts made
          against it. Payouts can also be recorded for a village alone.
        </p>
      </div>
      <PayoutsManager payouts={payouts} pending={pending} villageOptions={villageOptions} visitOptions={visitOptions} />
    </div>
  );
}
