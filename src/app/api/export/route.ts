import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { statementDetailCsv, teamSummaryCsv, type StatementWithName } from "@/lib/export";
import { fmtMonth, fullName } from "@/lib/format";
import { buildStatementsPdf } from "@/lib/pdf";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Profile, Statement } from "@/lib/types";

/**
 * Export měsíčního výkazu.
 *  ?period=YYYY-MM-01&format=csv|pdf[&user=<uuid>][&detail=1]
 * Bez `user` = celý tým (jen admin). S `user` = jeden instruktor (vlastník nebo admin).
 * Data se čtou v kontextu uživatele => oprávnění vynucuje i databáze.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me || !me.profile.is_active) return NextResponse.json({ error: "Nepřihlášen" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const period = sp.get("period") ?? "";
  const format = sp.get("format") === "pdf" ? "pdf" : "csv";
  const userId = sp.get("user");
  if (!/^\d{4}-\d{2}-01$/.test(period)) return NextResponse.json({ error: "Neplatné období" }, { status: 400 });
  if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "Neplatný uživatel" }, { status: 400 });
  if (!userId && !isAdmin(me)) return NextResponse.json({ error: "Export celého týmu je pouze pro správce" }, { status: 403 });
  if (userId && userId !== me.id && !isAdmin(me)) return NextResponse.json({ error: "Nemáte oprávnění" }, { status: 403 });

  const supabase = await createSupabaseServer();
  let ids: string[];
  if (userId) ids = [userId];
  else {
    const { data, error } = await supabase.rpc("team_overview", { p_period: period, p_lesson_type: null, p_location: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    ids = (data as { user_id: string }[]).map((r) => r.user_id);
  }

  const { data: profiles } = await supabase.from("profiles").select("id, first_name, last_name").in("id", ids);
  const names = new Map((profiles as Pick<Profile, "id" | "first_name" | "last_name">[] | null ?? []).map((p) => [p.id, fullName(p)]));

  const statements: StatementWithName[] = [];
  for (const id of ids) {
    const { data, error } = await supabase.rpc("monthly_statement", { p_user: id, p_period: period });
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    statements.push({ ...(data as Statement), name: names.get(id) ?? id });
  }
  statements.sort((a, b) => a.name.localeCompare(b.name, "cs"));

  const detail = Boolean(userId) || sp.get("detail") === "1";
  const base = `vykaz-${period.slice(0, 7)}${userId ? `-${(names.get(userId) ?? "instruktor").normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}` : "-tym"}`;
  const headers = { "Cache-Control": "private, no-store" };

  if (format === "csv") {
    const csv = detail ? statementDetailCsv(statements) : teamSummaryCsv(statements);
    return new NextResponse(csv, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
    });
  }
  const pdf = await buildStatementsPdf({
    title: userId ? `Výkaz – ${names.get(userId)}` : "Měsíční vyúčtování instruktorů",
    periodLabel: fmtMonth(period),
    closed: statements.every((s) => s.closed),
    statements,
    detail,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
  });
}
