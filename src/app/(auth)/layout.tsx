import { CalendarDays, Snowflake, Sparkles, Wallet } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="ice-gradient relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Snowflake className="size-6 text-sky-200" />
          </span>
          <div>
            <div className="font-[family-name:var(--font-display)] text-lg font-bold">Kluziště Praha</div>
            <div className="text-sm text-sky-100/70">Instructor Hub</div>
          </div>
        </div>
        <div className="max-w-md space-y-6">
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-extrabold leading-tight">
            Směny, lekce a odměny instruktorů na jednom místě.
          </h1>
          <ul className="space-y-3 text-sky-50/90">
            <li className="flex gap-3"><CalendarDays className="size-5 text-sky-300" /> Přihlašování na volné lekce jedním klepnutím</li>
            <li className="flex gap-3"><Sparkles className="size-5 text-sky-300" /> Výkonové kredity a bonusy v reálném čase</li>
            <li className="flex gap-3"><Wallet className="size-5 text-sky-300" /> Přehledné měsíční výkazy a odměny</li>
          </ul>
        </div>
        <p className="text-xs text-sky-100/50">Zimní sezóna {new Date().getFullYear()}/{(new Date().getFullYear() + 1) % 100}</p>
        <div className="pointer-events-none absolute -bottom-32 -right-32 size-96 rounded-full bg-sky-400/20 blur-3xl" />
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
