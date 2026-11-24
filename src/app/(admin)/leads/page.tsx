import { requireActiveTeamMember } from "@/lib/auth/session";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { LeadsWorkspace } from "@/components/admin/leads/leads-workspace";

export const dynamic = "force-dynamic";


export default async function LeadsPage() {
  await requireActiveTeamMember();
  const supabase = await createClient();

  // All leads and list memberships (paged past Supabase's 1,000-row response cap).
  const [leads, { data: lists }, { data: attributes }, memberships] = await Promise.all([
    fetchAll((from, to) =>
      supabase.from("leads").select("*").order("updated_at", { ascending: false }).order("id").range(from, to),
    ),
    supabase.from("lead_lists").select("*").order("name"),
    supabase.from("lead_attributes").select("*").order("created_at"),
    fetchAll((from, to) =>
      supabase.from("lead_list_members").select("list_id, lead_id").order("list_id").order("lead_id").range(from, to),
    ),
  ]);

  const listIdsByLead = new Map<string, string[]>();
  for (const m of memberships) {
    listIdsByLead.set(m.lead_id, [...(listIdsByLead.get(m.lead_id) ?? []), m.list_id]);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="text-sm text-muted">
          Contacts collected from form submissions and WhatsApp conversations, organised into lists. Custom
          attributes are the details the AI agent collects and uses to fill WhatsApp templates.
        </p>
      </div>
      <LeadsWorkspace
        attributes={attributes ?? []}
        leads={leads.map((lead) => ({ ...lead, listIds: listIdsByLead.get(lead.id) ?? [] }))}
        lists={(lists ?? []).map((list) => ({
          ...list,
          memberCount: memberships.filter((m) => m.list_id === list.id).length,
        }))}
        truncated={false}
      />
    </div>
  );
}
