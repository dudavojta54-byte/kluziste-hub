import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import type { StatementWithName } from "@/lib/export";
import { buildStatementsPdf } from "@/lib/pdf";

const s: StatementWithName = {
  name: "Řehoř Žďárský", user_id: "u1", period: "2026-12-01", hours: 12.5, lessons: 7, lesson_credits: 28.75, bonus_credits: 3,
  total_credits: 31.75, bonus_amount: 500, model: "hourly", credit_rate: 0, hourly_rate: 250, fixed_amount: 0,
  monthly_credit_target: 40, base_amount: 3125, total_amount: 3625, closed: false, by_type: [],
  items: Array.from({ length: 60 }, (_, i) => ({
    id: String(i), occurrence_id: "o", title: `Školička bruslení – skupina ${i}`, starts_at: "2026-12-01T15:00:00Z",
    ends_at: "2026-12-01T16:30:00Z", lesson_type: "Školička bruslení", location: "Letná", status: "present" as const,
    hours: 1.5, credit_multiplier: 2, credits: 3,
  })),
  bonuses: [{ id: "b", reason: "last_minute", reason_text: "Záskok – úterý", awarded_on: "2026-12-10", credits: 3, amount: 500 }],
};

test("9. PDF výkaz s českou diakritikou a stránkováním", async () => {
  const bytes = await buildStatementsPdf({ title: "Výkaz", periodLabel: "Prosinec 2026", closed: false, statements: [s, { ...s, name: "Čeněk Šťastný" }], detail: true });
  expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThan(2);   // 120 řádků => více stran
  expect(doc.getTitle()).toBe("Výkaz – Prosinec 2026");
});
