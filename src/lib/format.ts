import { TIME_ZONE } from "./constants";

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TIME_ZONE, day: "numeric", month: "numeric", year: "numeric" });
const dateShortFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TIME_ZONE, day: "numeric", month: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TIME_ZONE, weekday: "short" });
const weekdayLongFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: "UTC", month: "long", year: "numeric" });
const czk = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });

export const fmtDate = (iso: string | Date) => dateFmt.format(new Date(iso));
export const fmtDateShort = (iso: string | Date) => dateShortFmt.format(new Date(iso));
export const fmtWeekday = (iso: string | Date) => weekdayFmt.format(new Date(iso));
export const fmtDayLong = (iso: string | Date) => weekdayLongFmt.format(new Date(iso));
export const fmtTime = (iso: string | Date) => timeFmt.format(new Date(iso));
export const fmtTimeRange = (start: string, end: string) => `${fmtTime(start)}–${fmtTime(end)}`;
export const fmtDateTime = (iso: string) => `${fmtDate(iso)} ${fmtTime(iso)}`;
export const fmtMoney = (v: number | null | undefined) => (v == null ? "—" : czk.format(Number(v)));
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : num.format(Number(v)));
export const fmtHours = (v: number | null | undefined) => `${fmtNum(v ?? 0)} h`;

/** "2026-12-01" -> "prosinec 2026" */
export const fmtMonth = (period: string) => {
  const s = monthFmt.format(new Date(`${period.slice(0, 7)}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const fullName = (p: { first_name: string; last_name: string } | null | undefined) =>
  p ? `${p.first_name} ${p.last_name}`.trim() || "Bez jména" : "—";

export const initials = (p: { first_name: string; last_name: string } | null | undefined) =>
  p ? `${p.first_name.charAt(0)}${p.last_name.charAt(0)}`.toUpperCase() || "?" : "?";

export function durationHours(start: string, end: string) {
  return Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) * 100) / 100;
}

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "právě teď";
  if (diff < 3600) return `před ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `před ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `před ${Math.floor(diff / 86400)} d`;
  return fmtDate(iso);
}
