import { requireActiveTeamMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireActiveTeamMember();

  // Inbox badge: conversations that are unread or waiting for a person (the inbox's "Unread" and
  // "Needs a person" filters). One head-only count, so no rows come back.
  const supabase = await createClient();
  const { count } = await supabase
    .from("whatsapp_conversations")
    .select("id", { count: "exact", head: true })
    .or("unread_count.gt.0,needs_human.eq.true");

  return (
    <AdminShell email={email} inboxCount={count ?? 0}>
      {children}
    </AdminShell>
  );
}
