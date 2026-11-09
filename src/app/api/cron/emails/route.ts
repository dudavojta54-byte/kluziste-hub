import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Odeslání e-mailové fronty (email_outbox) přes Resend.
 * Spouští Vercel Cron (viz vercel.json) s hlavičkou Authorization: Bearer CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return NextResponse.json({ configured: false, sent: 0 });

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const admin = createSupabaseAdmin();
  const { data: batch, error } = await admin
    .from("email_outbox")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", 5)
    .order("created_at")
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const m of batch ?? []) {
    const body = String(m.body).replace(/(^|\n)(\/[^\s]*)$/m, (_: string, pre: string, path: string) => `${pre}${site}${path}`);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: m.to_email,
        subject: `${m.subject} · Kluziště Praha`,
        text: `${body}\n\n—\nInstructor Hub · Kluziště Praha\nUpozornění e-mailem lze vypnout v profilu: ${site}/profil`,
      }),
    });
    if (res.ok) {
      sent++;
      await admin.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: m.attempts + 1 }).eq("id", m.id);
    } else {
      const err = await res.text();
      await admin.from("email_outbox").update({
        status: m.attempts + 1 >= 5 ? "failed" : "pending", attempts: m.attempts + 1, last_error: err.slice(0, 500),
      }).eq("id", m.id);
    }
  }
  return NextResponse.json({ configured: true, sent, processed: batch?.length ?? 0 });
}
