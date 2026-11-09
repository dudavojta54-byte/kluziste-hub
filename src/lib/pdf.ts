import "server-only";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { ATTENDANCE_STATUS, BONUS_REASON, REWARD_MODEL } from "./constants";
import type { StatementWithName } from "./export";

const NAVY = rgb(0.12, 0.17, 0.32);
const ICE = rgb(0.2, 0.55, 0.85);
const GREY = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.86, 0.89, 0.93);

const n2 = (v: number) => new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(Number(v));
const czk = (v: number) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(Number(v));
const d = (iso: string) => new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric" }).format(new Date(iso));

interface Ctx { doc: PDFDocument; page: PDFPage; y: number; regular: PDFFont; bold: PDFFont }

const MARGIN = 40;
const WIDTH = 595.28;
const HEIGHT = 841.89;

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([WIDTH, HEIGHT]);
  ctx.y = HEIGHT - MARGIN;
}

function ensure(ctx: Ctx, h: number) {
  if (ctx.y - h < MARGIN + 20) newPage(ctx);
}

function text(ctx: Ctx, s: string, x: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right"; maxWidth?: number } = {}) {
  const font = opts.bold ? ctx.bold : ctx.regular;
  const size = opts.size ?? 9;
  let str = s;
  if (opts.maxWidth) {
    while (str.length > 1 && font.widthOfTextAtSize(str, size) > opts.maxWidth) str = str.slice(0, -2) + "…";
  }
  const w = font.widthOfTextAtSize(str, size);
  ctx.page.drawText(str, { x: opts.align === "right" ? x - w : x, y: ctx.y, size, font, color: opts.color ?? NAVY });
}

function table(ctx: Ctx, cols: { label: string; x: number; align?: "left" | "right"; w?: number }[], rows: string[][], boldLast = false) {
  ensure(ctx, 30);
  for (const c of cols) text(ctx, c.label, c.x, { bold: true, size: 8, color: GREY, align: c.align });
  ctx.y -= 6;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: WIDTH - MARGIN, y: ctx.y }, thickness: 0.7, color: LINE });
  ctx.y -= 12;
  rows.forEach((r, ri) => {
    ensure(ctx, 14);
    cols.forEach((c, i) => text(ctx, r[i] ?? "", c.x, { align: c.align, maxWidth: c.w, bold: boldLast && ri === rows.length - 1 }));
    ctx.y -= 14;
  });
  ctx.y -= 6;
}

export async function buildStatementsPdf(opts: {
  title: string;
  periodLabel: string;
  closed: boolean;
  statements: StatementWithName[];
  detail: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [r, b] = await Promise.all([readFile(path.join(dir, "Inter_400Regular.ttf")), readFile(path.join(dir, "Inter_700Bold.ttf"))]);
  const ctx: Ctx = { doc, page: doc.addPage([WIDTH, HEIGHT]), y: HEIGHT - MARGIN, regular: await doc.embedFont(r, { subset: true }), bold: await doc.embedFont(b, { subset: true }) };
  doc.setTitle(`${opts.title} – ${opts.periodLabel}`);
  doc.setCreator("Kluziště Praha | Instructor Hub");

  // Hlavička
  ctx.page.drawRectangle({ x: 0, y: HEIGHT - 70, width: WIDTH, height: 70, color: NAVY });
  ctx.y = HEIGHT - 32;
  text(ctx, "Kluziště Praha · Instructor Hub", MARGIN, { size: 9, color: rgb(0.7, 0.85, 0.97) });
  ctx.y -= 20;
  text(ctx, `${opts.title} – ${opts.periodLabel}`, MARGIN, { size: 16, bold: true, color: rgb(1, 1, 1) });
  ctx.y = HEIGHT - 92;
  text(ctx, `Vygenerováno ${new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })} · ${opts.closed ? "Výkaz uzavřen" : "Předběžný výkaz (měsíc není uzavřen)"}`, MARGIN, { size: 8, color: GREY });
  ctx.y -= 24;

  if (opts.statements.length > 1 || !opts.detail) {
    text(ctx, "Souhrn", MARGIN, { size: 12, bold: true });
    ctx.y -= 18;
    const rows = opts.statements.map((s) => [
      s.name, s.model ? REWARD_MODEL[s.model].label : "—", n2(s.hours), n2(s.lesson_credits), n2(s.bonus_credits), czk(s.bonus_amount), czk(s.total_amount),
    ]);
    const sum = (k: "hours" | "lesson_credits" | "bonus_credits" | "bonus_amount" | "total_amount") => opts.statements.reduce((a, s) => a + Number(s[k]), 0);
    rows.push(["Celkem", "", n2(sum("hours")), n2(sum("lesson_credits")), n2(sum("bonus_credits")), czk(sum("bonus_amount")), czk(sum("total_amount"))]);
    table(ctx, [
      { label: "Instruktor", x: MARGIN, w: 130 },
      { label: "Model", x: 175, w: 90 },
      { label: "Hodiny", x: 310, align: "right" },
      { label: "Kredity", x: 365, align: "right" },
      { label: "Bonus kr", x: 420, align: "right" },
      { label: "Bonus Kč", x: 475, align: "right" },
      { label: "Celkem", x: WIDTH - MARGIN, align: "right" },
    ], rows, true);
  }

  if (opts.detail) {
    for (const s of opts.statements) {
      ensure(ctx, 120);
      ctx.y -= 8;
      text(ctx, s.name, MARGIN, { size: 12, bold: true, color: ICE });
      ctx.y -= 16;
      text(ctx, `${s.model ? REWARD_MODEL[s.model].label : "Model nenastaven"} · ${n2(s.hours)} h · ${n2(s.total_credits)} kreditů${s.monthly_credit_target ? ` (cíl ${n2(s.monthly_credit_target)})` : ""} · celkem ${czk(s.total_amount)}`, MARGIN, { color: GREY });
      ctx.y -= 18;
      table(ctx, [
        { label: "Datum", x: MARGIN },
        { label: "Lekce", x: 80, w: 150 },
        { label: "Typ", x: 235, w: 105 },
        { label: "Účast", x: 345, w: 70 },
        { label: "Hodiny", x: 450, align: "right" },
        { label: "×", x: 490, align: "right" },
        { label: "Kredity", x: WIDTH - MARGIN, align: "right" },
      ], [
        ...s.items.map((i) => [d(i.starts_at), i.title, i.lesson_type, ATTENDANCE_STATUS[i.status], n2(i.hours), n2(i.credit_multiplier), n2(i.credits)]),
        ...s.bonuses.map((b) => [d(`${b.awarded_on}T12:00:00Z`), `Bonus: ${b.reason_text}`, BONUS_REASON[b.reason], b.amount > 0 ? czk(b.amount) : "", "", "", n2(b.credits)]),
      ]);
      const lines: [string, string][] = [
        ["Kredity za lekce", n2(s.lesson_credits)],
        ["Bonusové kredity", n2(s.bonus_credits)],
        ["Základ odměny", czk(s.base_amount)],
        ["Finanční bonusy", czk(s.bonus_amount)],
      ];
      for (const [l, v] of lines) { ensure(ctx, 14); text(ctx, l, 380, { color: GREY }); text(ctx, v, WIDTH - MARGIN, { align: "right" }); ctx.y -= 13; }
      ensure(ctx, 16);
      text(ctx, "Celkem k výplatě", 380, { bold: true }); text(ctx, czk(s.total_amount), WIDTH - MARGIN, { bold: true, align: "right" });
      ctx.y -= 22;
    }
  }

  // patička
  doc.getPages().forEach((p, i, all) => {
    p.drawText(`Strana ${i + 1} / ${all.length}`, { x: WIDTH - MARGIN - 50, y: 22, size: 7, font: ctx.regular, color: GREY });
  });
  return doc.save();
}
