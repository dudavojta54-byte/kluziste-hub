import { describe, expect, test } from "vitest";
import {
  addMonths, endOfMonth, generateSeriesDates, isoWeekday, monthGrid, pragueDate, pragueTime, startOfWeek,
} from "@/lib/dates";
import { csvCell, statementDetailCsv, teamSummaryCsv, type StatementWithName } from "@/lib/export";
import { parseBulkDates, passwordProblem } from "@/lib/validation";

describe("kalendářní výpočty (Europe/Prague)", () => {
  test("převod okamžiku na pražské datum a čas přes letní/zimní čas", () => {
    expect(pragueDate("2026-12-31T23:30:00Z")).toBe("2027-01-01");   // SEČ UTC+1
    expect(pragueTime("2026-12-01T15:00:00Z")).toBe("16:00");
    expect(pragueTime("2027-04-06T14:00:00Z")).toBe("16:00");          // SELČ UTC+2
  });
  test("týden začíná pondělím, měsíční mřížka má celé týdny", () => {
    expect(isoWeekday("2026-11-08")).toBe(7);
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");
    const grid = monthGrid("2026-12-15");
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe("2026-11-30");
    expect(endOfMonth("2027-02-10")).toBe("2027-02-28");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
  });
  test("týdenní opakování lekcí", () => {
    expect(generateSeriesDates({ start: "2026-12-01", until: "2026-12-31", weekdays: [2] }))
      .toEqual(["2026-12-01", "2026-12-08", "2026-12-15", "2026-12-22", "2026-12-29"]);
    expect(generateSeriesDates({ start: "2026-12-01", until: "2026-12-31", weekdays: [2, 4], everyWeeks: 2 }))
      .toEqual(["2026-12-01", "2026-12-03", "2026-12-15", "2026-12-17", "2026-12-29", "2026-12-31"]);
    expect(generateSeriesDates({ start: "2026-12-10", until: "2026-12-01", weekdays: [1] })).toEqual([]);
  });
  test("hromadné zadání dat", () => {
    const r = parseBulkDates("6.12.2026, 13.12.2026\n2026-12-20; 31.2.2026 foo");
    expect(r.dates).toEqual(["2026-12-06", "2026-12-13", "2026-12-20"]);
    expect(r.invalid).toEqual(["31.2.2026", "foo"]);
  });
});

describe("hesla", () => {
  test("politika hesla", () => {
    expect(passwordProblem("kratke1")).toMatch(/10 znaků/);
    expect(passwordProblem("jenpismenaaa")).toMatch(/číslice/);
    expect(passwordProblem("Brusle2026!")).toBeNull();
  });
});

describe("9. měsíční export CSV", () => {
  const s: StatementWithName = {
    name: "Anna Nováková", user_id: "u1", period: "2026-12-01", hours: 3, lessons: 2, lesson_credits: 7.5, bonus_credits: 2,
    total_credits: 9.5, bonus_amount: 500, model: "credit", credit_rate: 100, hourly_rate: 0, fixed_amount: 0,
    monthly_credit_target: null, base_amount: 950, total_amount: 1450, closed: true,
    by_type: [],
    items: [{ id: "a", occurrence_id: "o", title: "Školička; \"začátečníci\"", starts_at: "2026-12-01T15:00:00Z", ends_at: "2026-12-01T16:30:00Z",
      lesson_type: "Školička bruslení", location: "Letná", status: "present", hours: 1.5, credit_multiplier: 2, credits: 3 }],
    bonuses: [{ id: "b", reason: "last_minute", reason_text: "Záskok", awarded_on: "2026-12-10", credits: 2, amount: 500 }],
  };

  test("souhrn: BOM, středník, české desetinné čárky a součtový řádek", () => {
    const csv = teamSummaryCsv([s, { ...s, name: "Petr Svoboda", total_amount: 1000, hours: 2 }]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Instruktor;Model odměny;Hodiny");
    expect(lines[1]).toBe("Anna Nováková;A – Kreditová;3;2;7,5;2;9,5;500;950;1450");
    expect(lines.at(-1)).toBe("Celkem;;5;4;15;4;19;1000;1900;2450");
  });

  test("detail: řádky lekcí, bonusů a souhrnu, správné escapování", () => {
    const csv = statementDetailCsv([s]);
    expect(csv).toContain('"Školička; ""začátečníci"""');
    expect(csv).toContain("1.12.2026;16:00–17:30");
    expect(csv).toContain("Záskok na poslední chvíli");
    expect(csv).toContain("SOUHRN");
  });

  test("ochrana proti vzorcům v Excelu", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell(-5)).toBe("-5");
  });
});
