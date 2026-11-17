import { ServicesManager } from "@/components/admin/services/services-manager";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadServices } from "@/lib/invoices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  await requireActiveTeamMember();
  const supabase = await createClient();

  const [services, { data: villages }] = await Promise.all([
    loadServices(supabase),
    supabase.from("villages").select("id, name, is_active").order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Services</h1>
        <p className="text-sm text-muted">
          What the foundation charges for: the base amount and GST, where each service runs and who it&apos;s for,
          and the group slabs that set discounts and free guides. Proforma invoices are priced from here.
        </p>
      </div>
      <ServicesManager services={services} villages={villages ?? []} />
    </div>
  );
}
