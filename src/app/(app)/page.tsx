import { AdminDashboardView } from "@/components/dashboard/admin-dashboard";
import { InstructorDashboard } from "@/components/dashboard/instructor-dashboard";
import { isStaff, requireUser } from "@/lib/auth";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const view = (await searchParams).pohled;
  // Správce/koordinátor vidí provozní přehled; pokud zároveň učí, může přepnout na osobní.
  if (isStaff(user) && view !== "osobni") return <AdminDashboardView />;
  return <InstructorDashboard />;
}
