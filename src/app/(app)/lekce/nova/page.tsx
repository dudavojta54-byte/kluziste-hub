import type { Metadata } from "next";
import { PageHeader } from "@/components/common";
import { LessonForm } from "@/components/lessons/lesson-form";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Nová lekce" };

export default async function NewLessonPage({ searchParams }: PageProps<"/lekce/nova">) {
  await requireRole("admin", "coordinator");
  const { kopie } = await searchParams;
  return (
    <>
      <PageHeader
        title={kopie ? "Kopie lekce" : "Nová lekce"}
        description="Jednorázová lekce, týdenní série nebo hromadné vytvoření více termínů."
      />
      <LessonForm copyFrom={typeof kopie === "string" ? kopie : undefined} />
    </>
  );
}
