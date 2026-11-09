"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Field, NativeSelect, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WEEKDAYS_SHORT } from "@/lib/constants";
import { addDays, generateSeriesDates, isoWeekday, pragueDate, pragueTime, todayPrague } from "@/lib/dates";
import { fmtDate } from "@/lib/format";
import { useLessonTypes, useLocations, useOccurrence, useRpc } from "@/lib/queries";
import { lessonFormSchema, parseBulkDates, type LessonFormOutput, type LessonFormValues } from "@/lib/validation";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function LessonForm({ copyFrom }: { copyFrom?: string }) {
  const router = useRouter();
  const types = useLessonTypes();
  const locations = useLocations();
  const source = useOccurrence(copyFrom ?? "");
  const create = useRpc<{ p: Record<string, unknown> }, string>("create_lesson", {});

  const tomorrow = addDays(todayPrague(), 1);
  const form = useForm<LessonFormValues, unknown, LessonFormOutput>({
    resolver: zodResolver(lessonFormSchema),
    defaultValues: {
      title: "",
      lesson_type_id: "",
      location_id: "",
      date: tomorrow,
      start_time: "16:00",
      end_time: "17:00",
      required_instructors: 1,
      credit_multiplier: "",
      description: "",
      instructions: "",
      registration_status: "open",
      registration_deadline_hours: 24,
      repeat: "none",
      repeat_until: addDays(tomorrow, 56),
      weekdays: [isoWeekday(tomorrow)],
      every_weeks: 1,
      bulk_dates: "",
      notify: true,
    },
  });

  // Kopie existující lekce
  useEffect(() => {
    const o = source.data;
    if (!copyFrom || !o) return;
    form.reset({
      ...form.getValues(),
      title: o.title,
      lesson_type_id: o.lesson_type_id,
      location_id: o.location_id,
      start_time: pragueTime(o.starts_at),
      end_time: pragueTime(o.ends_at),
      required_instructors: o.required_instructors,
      credit_multiplier: String(o.credit_multiplier),
      description: o.description ?? "",
      instructions: o.instructions ?? "",
      date: addDays(pragueDate(o.starts_at), 7),
      weekdays: [isoWeekday(pragueDate(o.starts_at))],
    });
  }, [copyFrom, source.data, form]);

  const v = useWatch({ control: form.control });
  const selectedType = types.data?.find((t) => t.id === v.lesson_type_id);

  const dates = useMemo(() => {
    if (v.repeat === "weekly" && v.date && v.repeat_until) {
      return generateSeriesDates({
        start: v.date, until: v.repeat_until, weekdays: v.weekdays ?? [], everyWeeks: Number(v.every_weeks) || 1,
      });
    }
    if (v.repeat === "bulk") return parseBulkDates(v.bulk_dates ?? "").dates;
    return v.date ? [v.date] : [];
  }, [v.repeat, v.date, v.repeat_until, v.weekdays, v.every_weeks, v.bulk_dates]);
  const bulkInvalid = v.repeat === "bulk" ? parseBulkDates(v.bulk_dates ?? "").invalid : [];

  const onSubmit = form.handleSubmit(async (values) => {
    if (dates.length === 0) return toast.error("Zadejte alespoň jeden termín.");
    if (dates.length > 200) return toast.error("Najednou lze vytvořit nejvýše 200 termínů.");
    if (selectedType?.credit_multiplier == null && values.credit_multiplier === "") {
      form.setError("credit_multiplier", { message: "U tohoto programu zadejte násobek" });
      return;
    }
    const lessonId = await create.mutateAsync({
      p: {
        title: values.title,
        lesson_type_id: values.lesson_type_id,
        location_id: values.location_id,
        description: values.description || null,
        instructions: values.instructions || null,
        required_instructors: values.required_instructors,
        credit_multiplier: values.credit_multiplier === "" ? null : values.credit_multiplier,
        start_time: values.start_time,
        end_time: values.end_time,
        dates,
        recurrence: values.repeat === "weekly" ? "weekly" : values.repeat === "bulk" ? "custom" : "none",
        registration_status: values.registration_status,
        registration_deadline_hours: values.registration_deadline_hours,
        notify: values.notify,
      },
    }).catch(() => null);
    if (!lessonId) return;
    toast.success(dates.length === 1 ? "Lekce vytvořena." : `Vytvořeno ${dates.length} termínů.`);
    const { data } = await getSupabase().from("lesson_occurrences").select("id")
      .eq("lesson_id", lessonId).order("starts_at").limit(1).single();
    router.push(data ? `/lekce/${data.id}?novy=1` : "/lekce");
  });

  const err = form.formState.errors;
  const toggleWeekday = (d: number) => {
    const cur = form.getValues("weekdays");
    form.setValue("weekdays", cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort());
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3" noValidate>
      <div className="space-y-6 lg:col-span-2">
        <Card className="gap-4 p-4 sm:p-6">
          <h2 className="font-semibold">Základní údaje</h2>
          <Field label="Název lekce" error={err.title?.message}>
            <Input placeholder="např. Školička bruslení – pokročilí" {...form.register("title")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Typ programu" error={err.lesson_type_id?.message}>
              <NativeSelect {...form.register("lesson_type_id")}>
                <option value="">Vyberte…</option>
                {types.data?.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Lokalita kluziště" error={err.location_id?.message}>
              <NativeSelect {...form.register("location_id")}>
                <option value="">Vyberte…</option>
                {locations.data?.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label={v.repeat === "bulk" ? "Datum (nepoužito)" : "Datum"} error={err.date?.message} className="col-span-2 sm:col-span-2">
              <Input type="date" disabled={v.repeat === "bulk"} {...form.register("date")} />
            </Field>
            <Field label="Začátek" error={err.start_time?.message}>
              <Input type="time" step={300} {...form.register("start_time")} />
            </Field>
            <Field label="Konec" error={err.end_time?.message}>
              <Input type="time" step={300} {...form.register("end_time")} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Potřebný počet instruktorů" error={err.required_instructors?.message}>
              <Input type="number" min={1} max={50} {...form.register("required_instructors")} />
            </Field>
            <Field
              label="Kreditový násobek"
              error={err.credit_multiplier?.message}
              hint={selectedType?.credit_multiplier != null ? `Výchozí pro typ: ${selectedType.credit_multiplier} kr / hod` : "U tohoto typu je povinný"}
            >
              <Input type="number" step="0.05" min={0} max={10}
                placeholder={selectedType?.credit_multiplier != null ? String(selectedType.credit_multiplier) : "např. 2"}
                {...form.register("credit_multiplier")} />
            </Field>
          </div>
        </Card>

        <Card className="gap-4 p-4 sm:p-6">
          <h2 className="font-semibold">Popis a pokyny</h2>
          <Field label="Popis programu">
            <Textarea rows={3} placeholder="Pro koho je lekce určena, obsah…" {...form.register("description")} />
          </Field>
          <Field label="Pokyny pro instruktory">
            <Textarea rows={3} placeholder="Sraz 15 min předem u pokladny, vybavení…" {...form.register("instructions")} />
          </Field>
        </Card>

        <Card className="gap-4 p-4 sm:p-6">
          <h2 className="flex items-center gap-2 font-semibold"><Repeat className="size-4" /> Termíny</h2>
          <div className="grid grid-cols-3 gap-2">
            {([["none", "Jednorázově"], ["weekly", "Každý týden"], ["bulk", "Hromadně"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => form.setValue("repeat", k)}
                className={cn("rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  v.repeat === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                {label}
              </button>
            ))}
          </div>
          {v.repeat === "weekly" && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-sm font-medium">Dny v týdnu</div>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS_SHORT.map((d, i) => (
                    <button key={d} type="button" onClick={() => toggleWeekday(i + 1)}
                      className={cn("size-10 rounded-lg border text-sm font-medium",
                        v.weekdays?.includes(i + 1) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Opakovat do" error={err.repeat_until?.message}>
                  <Input type="date" {...form.register("repeat_until")} />
                </Field>
                <Field label="Interval">
                  <NativeSelect {...form.register("every_weeks")}>
                    <option value={1}>Každý týden</option>
                    <option value={2}>Každý 2. týden</option>
                    <option value={3}>Každý 3. týden</option>
                    <option value={4}>Každý 4. týden</option>
                  </NativeSelect>
                </Field>
              </div>
            </div>
          )}
          {v.repeat === "bulk" && (
            <Field label="Seznam dat" hint="Oddělte čárkou nebo novým řádkem, např. 6.12.2026, 13.12.2026"
              error={bulkInvalid.length ? `Neplatná data: ${bulkInvalid.join(", ")}` : undefined}>
              <Textarea rows={4} {...form.register("bulk_dates")} />
            </Field>
          )}
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            <b>{dates.length}</b> {dates.length === 1 ? "termín" : dates.length < 5 ? "termíny" : "termínů"}
            {dates.length > 0 && (
              <span className="text-muted-foreground">
                {" "}· {dates.slice(0, 6).map((d) => fmtDate(`${d}T12:00:00Z`)).join(", ")}{dates.length > 6 ? " …" : ""}
              </span>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="gap-4 p-4 sm:p-6 lg:sticky lg:top-20">
          <h2 className="font-semibold">Přihlašování</h2>
          <Field label="Stav přihlašování">
            <NativeSelect {...form.register("registration_status")}>
              <option value="open">Otevřené – instruktoři se mohou hlásit</option>
              <option value="closed">Uzavřené – obsazuje koordinátor</option>
            </NativeSelect>
          </Field>
          <Field label="Uzávěrka přihlášek" hint="Počet hodin před začátkem lekce">
            <Input type="number" min={0} max={720} {...form.register("registration_deadline_hours")} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={v.notify} onCheckedChange={(c) => form.setValue("notify", Boolean(c))} />
            Upozornit instruktory na novou lekci
          </label>
          <Button type="submit" size="lg" className="h-11 w-full" disabled={form.formState.isSubmitting || create.isPending}>
            {(form.formState.isSubmitting || create.isPending) ? <Spinner /> : <CalendarPlus />}
            {dates.length > 1 ? `Vytvořit ${dates.length} termínů` : "Vytvořit lekci"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Po vytvoření se zobrazí návrh vhodných instruktorů podle dostupnosti, specializace a rozvrhu.
          </p>
        </Card>
      </div>
    </form>
  );
}
