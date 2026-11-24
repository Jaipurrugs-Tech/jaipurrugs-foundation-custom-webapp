import { redirect } from "next/navigation";

/** The "AI Insights" tab is hidden until the feature exists; old links land on the submissions. */
export default async function FormInsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/forms/${id}/submissions`);
}
