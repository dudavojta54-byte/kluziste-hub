import { OccurrenceDetail } from "@/components/lessons/occurrence-detail";

export default async function OccurrencePage({ params }: PageProps<"/lekce/[id]">) {
  const { id } = await params;
  return <OccurrenceDetail id={id} />;
}
