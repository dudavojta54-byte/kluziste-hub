/**
 * Veřejné údaje Supabase projektu. Podporuje nový publishable klíč (sb_publishable_…)
 * i starší anon klíč. Proměnné musí být uvedené doslova, aby je Next.js vložil do klienta.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
