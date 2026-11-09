import { test, expect } from "vitest";
import { createDb } from "./harness";

test("migrace proběhnou na čisté databázi", async () => {
  const db = await createDb();
  const r = await db.query<{ n: number }>("select count(*)::int n from public.lesson_types");
  expect(r.rows[0].n).toBe(6);
});
