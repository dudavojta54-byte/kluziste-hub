import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { AdminPanel } from "./admin-panel";

export const metadata: Metadata = { title: "Správa" };

export default async function AdminPage() {
  await requireRole("admin");
  return <AdminPanel />;
}
