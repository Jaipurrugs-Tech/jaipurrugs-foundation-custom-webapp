import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";
import { todayIST } from "@/lib/visits/time";
import { loadInvoiceVisitOptions, loadServices } from "./queries";

/** Everything the PI editor needs besides the PI itself. */
export async function loadInvoiceEditorData(supabase: SupabaseClient<Database>, visitId: string | null) {
  const [services, visits, { data: terms }, { data: settings }] = await Promise.all([
    loadServices(supabase),
    loadInvoiceVisitOptions(supabase, visitId),
    supabase.from("invoice_terms").select("*").order("position").order("created_at"),
    supabase.from("invoice_settings").select("number_prefix, default_payment_terms").maybeSingle(),
  ]);
  return {
    services,
    visits,
    termsLibrary: terms ?? [],
    defaults: {
      today: todayIST(),
      paymentTerms: settings?.default_payment_terms ?? "",
      numberPrefix: settings?.number_prefix ?? "PI",
    },
  };
}
