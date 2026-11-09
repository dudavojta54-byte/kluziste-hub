"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "@/lib/supabase/env";

let client: SupabaseClient | undefined;

/** Prohlížečový klient (anon klíč + session cookie). Veškerý přístup chrání RLS. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY,
    );
  }
  return client;
}
