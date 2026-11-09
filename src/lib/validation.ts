import { z } from "zod";

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Heslo musí mít alespoň 10 znaků.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Heslo musí obsahovat písmena i číslice.";
  return null;
}

const time = z.string().regex(/^\d{2}:\d{2}$/, "Zadejte čas HH:MM");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Zadejte datum");

export const lessonFormSchema = z
  .object({
    title: z.string().trim().min(2, "Zadejte název lekce").max(160),
    lesson_type_id: z.string().uuid("Vyberte typ programu"),
    location_id: z.string().uuid("Vyberte lokalitu"),
    date,
    start_time: time,
    end_time: time,
    required_instructors: z.coerce.number().int().min(1, "Alespoň 1").max(50),
    credit_multiplier: z.union([z.literal(""), z.coerce.number().min(0).max(10)]).optional(),
    description: z.string().max(4000).optional(),
    instructions: z.string().max(4000).optional(),
    registration_status: z.enum(["open", "closed"]),
    registration_deadline_hours: z.coerce.number().int().min(0).max(720),
    repeat: z.enum(["none", "weekly", "bulk"]),
    repeat_until: z.string().optional(),
    weekdays: z.array(z.number().int().min(1).max(7)),
    every_weeks: z.coerce.number().int().min(1).max(4),
    bulk_dates: z.string().optional(),
    notify: z.boolean(),
  })
  .refine((v) => v.end_time > v.start_time, { path: ["end_time"], message: "Konec musí být po začátku" })
  .refine((v) => v.repeat !== "weekly" || (v.repeat_until && v.repeat_until >= v.date), {
    path: ["repeat_until"],
    message: "Zadejte datum konce opakování (po prvním termínu)",
  });

export type LessonFormValues = z.input<typeof lessonFormSchema>;
export type LessonFormOutput = z.output<typeof lessonFormSchema>;

export const inviteSchema = z.object({
  email: z.email("Zadejte platný e-mail"),
  first_name: z.string().trim().min(1, "Zadejte jméno"),
  last_name: z.string().trim().min(1, "Zadejte příjmení"),
  role: z.enum(["instructor", "coordinator", "admin"]),
});

/** Parsování hromadně vložených dat "1.12.2026, 8.12.2026" nebo "2026-12-01" */
export function parseBulkDates(text: string): { dates: string[]; invalid: string[] } {
  const tokens = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const dates: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    let iso: string | null = null;
    const cz = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (cz) iso = `${cz[3]}-${cz[2].padStart(2, "0")}-${cz[1].padStart(2, "0")}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t;
    const d = iso ? new Date(`${iso}T00:00:00Z`) : null;
    if (iso && d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) dates.push(iso);
    else invalid.push(t);
  }
  return { dates: [...new Set(dates)].sort(), invalid };
}
