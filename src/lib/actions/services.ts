"use server";

import { revalidatePath } from "next/cache";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { serviceSchema, type ServiceInput } from "@/lib/invoices/schemas";
import { blankToNull } from "@/lib/visits/schemas";
import { createClient } from "@/lib/supabase/server";

export type ServiceActionResult = { error?: string };

function revalidateServices() {
  revalidatePath("/services");
  revalidatePath("/invoices", "layout");
}

/** Creates (id = null) or updates a service with its locations and slabs, in one transaction. */
export async function saveService(id: string | null, input: ServiceInput): Promise<ServiceActionResult & { id?: string }> {
  const { email } = await requireActiveTeamMember();
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid service." };
  const data = parsed.data;

  const supabase = await createClient();
  const { data: savedId, error } = await supabase.rpc("save_service", {
    // null = create a new one. Generated RPC types can't mark an argument nullable.
    p_id: id as string,
    p_service: {
      name: data.name,
      description: blankToNull(data.description),
      sac_code: blankToNull(data.sacCode),
      pricing_unit: data.pricingUnit,
      base_rate: data.baseRate,
      gst_rate: data.gstRate,
      extra_guide_rate: data.extraGuideRate,
      custom_pricing_above: data.customPricingAbove,
      program_categories: data.programCategories,
      visitor_categories: data.visitorCategories,
      created_by: email,
    },
    p_village_ids: [...new Set(data.villageIds)],
    p_slabs: data.slabs.map((slab) => ({
      min_headcount: slab.minHeadcount,
      max_headcount: slab.maxHeadcount,
      discount_type: slab.discountType,
      discount_value: slab.discountValue,
      free_guides: slab.freeGuides,
    })),
  });
  if (error || !savedId) {
    if (error?.code === "23505") return { error: "A service with that name already exists." };
    if (error?.code === "23P01") return { error: "Two slabs overlap. Each headcount can be in one slab only." };
    if (error?.code === "P0002") return { error: "That service no longer exists." };
    return { error: "Could not save the service." };
  }
  revalidateServices();
  return { id: savedId };
}

export async function setServiceActive(id: string, isActive: boolean): Promise<ServiceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { error } = await supabase.from("services").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: "Could not update the service." };
  revalidateServices();
  return {};
}

/** PIs keep their own copy of each line, so deleting a service never changes an existing PI. */
export async function deleteService(id: string): Promise<ServiceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) return { error: "Could not delete the service." };
  revalidateServices();
  return {};
}
