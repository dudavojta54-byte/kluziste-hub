import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

export type Db = PGlite;

/** Nová izolovaná databáze (skutečný PostgreSQL ve WASM) se všemi migracemi. */
export async function createDb(): Promise<Db> {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (e) {
      throw new Error(`Migrace ${file} selhala: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Vytvoří uživatele v auth.users (trigger založí profil + roli instructor). */
export async function createUser(
  db: Db,
  opts: { email: string; first?: string; last?: string; roles?: string[] },
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [opts.email, JSON.stringify({ first_name: opts.first ?? "Test", last_name: opts.last ?? opts.email })],
  );
  const id = res.rows[0].id;
  if (opts.roles) {
    await db.query(`delete from public.user_roles where user_id = $1`, [id]);
    for (const r of opts.roles) {
      await db.query(`insert into public.user_roles (user_id, role) values ($1, $2)`, [id, r]);
    }
  }
  return id;
}

/** Spustí dotaz jako přihlášený uživatel (role authenticated + JWT sub) => platí RLS. */
export async function asUser<T = Record<string, unknown>>(
  db: Db,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    await tx.exec(userId ? "set local role authenticated" : "set local role anon");
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

/** Volání RPC funkce jako uživatel – vrací hodnotu funkce. */
export async function rpc<T = unknown>(
  db: Db,
  userId: string | null,
  fn: string,
  args: unknown[] = [],
): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await asUser<{ r: T }>(db, userId, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0]?.r as T;
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}
