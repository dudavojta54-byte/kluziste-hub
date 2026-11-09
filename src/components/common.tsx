"use client";

import { ChevronLeft, ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE_CLASSES, type Tone } from "@/lib/constants";
import { addMonths } from "@/lib/dates";
import { fmtMonth, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "relative gap-1 overflow-hidden p-4 sm:p-5",
        accent && "ice-gradient border-0 text-white",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-medium uppercase tracking-wide", accent ? "text-sky-100/80" : "text-muted-foreground")}>
          {label}
        </span>
        {Icon && <Icon className={cn("size-4", accent ? "text-sky-200" : "text-primary")} />}
      </div>
      <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums sm:text-3xl">{value}</div>
      {hint && <div className={cn("text-xs", accent ? "text-sky-100/80" : "text-muted-foreground")}>{hint}</div>}
    </Card>
  );
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function TypeDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}

export function EmptyState({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center">
      {Icon && <Icon className="mb-3 size-8 text-muted-foreground/60" />}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function LoadingList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

export function UserAvatar({
  profile,
  className,
}: {
  profile: { first_name: string; last_name: string; avatar_url?: string | null } | undefined;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8", className)}>
      {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
      <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">{initials(profile)}</AvatarFallback>
    </Avatar>
  );
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
      <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonths(value, -1))} aria-label="Předchozí měsíc">
        <ChevronLeft />
      </Button>
      <span className="min-w-32 text-center text-sm font-medium">{fmtMonth(value)}</span>
      <Button variant="ghost" size="icon-sm" onClick={() => onChange(addMonths(value, 1))} aria-label="Další měsíc">
        <ChevronRight />
      </Button>
    </div>
  );
}

/** Nativní select – spolehlivý na mobilu a snadno validovatelný */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold sm:text-lg">{children}</h2>
      {action}
    </div>
  );
}
