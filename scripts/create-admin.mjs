#!/usr/bin/env node
/**
 * Vytvoření prvního správce (pozvánkou e-mailem).
 *
 *   node --env-file=.env.local scripts/create-admin.mjs spravce@kluziste.cz Jana Horáková
 */
import { createClient } from "@supabase/supabase-js";

const [email, first = "", last = ""] = process.argv.slice(2);
if (!email) {
  console.error("Použití: node --env-file=.env.local scripts/create-admin.mjs <email> <jméno> <příjmení>");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
if (!url || !key) throw new Error("Chybí NEXT_PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
  data: { first_name: first, last_name: last },
  redirectTo: `${site}/auth/confirm`,
});
if (error) throw new Error(error.message);

const { error: rErr } = await admin.from("user_roles").upsert([
  { user_id: data.user.id, role: "admin" },
  { user_id: data.user.id, role: "instructor" },
]);
if (rErr) throw new Error(rErr.message);
console.log(`✓ Pozvánka pro správce odeslána na ${email}.`);
