/**
 * Práce s kalendářními daty v pražském čase. Datum = řetězec "YYYY-MM-DD"
 * (bez časové zóny), takže výpočty nejsou ovlivněny zónou prohlížeče.
 */
import { TIME_ZONE } from "./constants";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO okamžik -> kalendářní datum v Praze "YYYY-MM-DD" */
export function pragueDate(iso: string | Date): string {
  return partsFmt.format(new Date(iso));
}

export function todayPrague(): string {
  return pragueDate(new Date());
}

/** Lokální čas v Praze "HH:MM" */
export function pragueTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso));
}

const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function addMonths(date: string, months: number): string {
  const d = toUtc(date.slice(0, 7) + "-01");
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUtc(d);
}

/** ISO den v týdnu: 1 = pondělí … 7 = neděle */
export function isoWeekday(date: string): number {
  const w = toUtc(date).getUTCDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function startOfMonth(date: string): string {
  return date.slice(0, 7) + "-01";
}

export function endOfMonth(date: string): string {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Mřížka měsíčního kalendáře (celé týdny od pondělí) */
export function monthGrid(date: string): string[] {
  const first = startOfWeek(startOfMonth(date));
  const last = addDays(startOfWeek(endOfMonth(date)), 6);
  return daysBetween(first, last);
}

/**
 * Termíny opakující se lekce.
 * - weekly: každý týden ve vybrané dny týdne od `start` do `until` (včetně)
 * - interval: každých N týdnů
 */
export function generateSeriesDates(opts: {
  start: string;
  until: string;
  weekdays: number[];
  everyWeeks?: number;
  skip?: string[];
}): string[] {
  const { start, until, weekdays, everyWeeks = 1, skip = [] } = opts;
  if (until < start || weekdays.length === 0) return [];
  const weekAnchor = startOfWeek(start);
  const out: string[] = [];
  for (let d = start; d <= until; d = addDays(d, 1)) {
    const weekIndex = Math.round((toUtc(startOfWeek(d)).getTime() - toUtc(weekAnchor).getTime()) / (7 * 86400_000));
    if (weekIndex % everyWeeks !== 0) continue;
    if (!weekdays.includes(isoWeekday(d))) continue;
    if (skip.includes(d)) continue;
    out.push(d);
    if (out.length > 200) break;
  }
  return out;
}

/** UTC hranice pro dotaz na termíny v rozsahu pražských dnů (s rezervou na posun zóny) */
export function rangeToIso(from: string, to: string) {
  return {
    from: new Date(`${addDays(from, -1)}T22:00:00Z`).toISOString(),
    to: new Date(`${addDays(to, 1)}T02:00:00Z`).toISOString(),
  };
}
