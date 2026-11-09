import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Klient se service role klíčem – obchází RLS. Smí se použít výhradně
 * na serveru a až PO ověření oprávnění volajícího (viz lib/auth.ts).
 */
export function createSupabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Chybí SUPABASE_SERVICE_ROLE_KEY (nastavte v proměnných prostředí serveru).");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
