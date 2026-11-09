import { ATTENDANCE_STATUS, BONUS_REASON, REWARD_MODEL } from "./constants";
import { pragueDate } from "./dates";
import type { Statement } from "./types";

export interface StatementWithName extends Statement {
  name: string;
}

/** Hodnota pro CSV (oddělovač ;, české desetinné čárky, escapování uvozovek) */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : String(v);
  // ochrana proti CSV/formula injection v Excelu
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  // BOM, aby Excel správně načetl UTF-8 (diakritiku)
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

/** d.m.rrrr bez mezer – český Excel to načte jako datum */
const localDate = (iso: string) => {
  const [y, m, d] = pragueDate(iso).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};
const localTime = (iso: string) =>
  new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export const SUMMARY_HEADER = [
  "Instruktor", "Model odměny", "Hodiny", "Dokončené lekce", "Kredity za lekce", "Bonusové kredity",
  "Kredity celkem", "Finanční bonusy (Kč)", "Základ odměny (Kč)", "Celkem (Kč)",
];

export function summaryRow(s: StatementWithName): unknown[] {
  return [
    s.name, s.model ? REWARD_MODEL[s.model].label : "nenastaveno", Number(s.hours), Number(s.lessons),
    Number(s.lesson_credits), Number(s.bonus_credits), Number(s.total_credits), Number(s.bonus_amount),
    Number(s.base_amount), Number(s.total_amount),
  ];
}

export function teamSummaryCsv(statements: StatementWithName[]): string {
  const rows: unknown[][] = [SUMMARY_HEADER, ...statements.map(summaryRow)];
  const sum = (k: keyof Statement) => statements.reduce((a, s) => a + Number(s[k] ?? 0), 0);
  rows.push(["Celkem", "", sum("hours"), sum("lessons"), sum("lesson_credits"), sum("bonus_credits"),
    sum("total_credits"), sum("bonus_amount"), sum("base_amount"), sum("total_amount")]);
  return toCsv(rows);
}

export function statementDetailCsv(statements: StatementWithName[]): string {
  const rows: unknown[][] = [[
    "Instruktor", "Datum", "Čas", "Lekce", "Typ programu", "Lokalita", "Účast", "Hodiny", "Násobek", "Kredity", "Částka (Kč)", "Poznámka",
  ]];
  for (const s of statements) {
    for (const i of s.items) {
      rows.push([s.name, localDate(i.starts_at), `${localTime(i.starts_at)}–${localTime(i.ends_at)}`, i.title, i.lesson_type,
        i.location, ATTENDANCE_STATUS[i.status], Number(i.hours), Number(i.credit_multiplier), Number(i.credits), "", ""]);
    }
    for (const b of s.bonuses) {
      rows.push([s.name, localDate(`${b.awarded_on}T12:00:00Z`), "", "Bonus", BONUS_REASON[b.reason], "", "", "", "",
        Number(b.credits), Number(b.amount), b.reason_text]);
    }
    rows.push([s.name, "", "", "SOUHRN", s.model ? REWARD_MODEL[s.model].label : "", "", "", Number(s.hours), "",
      Number(s.total_credits), Number(s.total_amount), s.closed ? "uzavřeno" : "předběžné"]);
  }
  return toCsv(rows);
}
