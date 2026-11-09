"use client";

import {
  Bell,
  CalendarDays,
  ClipboardCheck,
  Contact,
  FileText,
  Home,
  Inbox,
  LogOut,
  Megaphone,
  Moon,
  Settings,
  Snowflake,
  Sun,
  User,
  Wallet,
  CalendarCheck,
  ListChecks,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { UserAvatar } from "@/components/common";
import { NotificationBell } from "@/components/notifications";
import { useUser } from "@/components/providers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_NAME, APP_SUBTITLE, ROLE_LABELS } from "@/lib/constants";
import { fullName } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  staff?: boolean;
  admin?: boolean;
  mobile?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Přehled", icon: Home, mobile: true },
  { href: "/kalendar", label: "Kalendář", icon: CalendarDays, mobile: true },
  { href: "/lekce", label: "Lekce", icon: ListChecks, mobile: true },
  { href: "/prihlasky", label: "Přihlášky", icon: Inbox, staff: true },
  { href: "/dostupnost", label: "Dostupnost", icon: CalendarCheck },
  { href: "/vykazy", label: "Výkazy a odměny", icon: Wallet, mobile: true },
  { href: "/tym", label: "Tým a kontakty", icon: Contact },
  { href: "/oznameni", label: "Oznámení", icon: Megaphone },
  { href: "/prirucka", label: "Příručka instruktora", icon: BookOpen },
  { href: "/info", label: "Provozní info", icon: FileText },
  { href: "/sprava", label: "Správa", icon: Settings, admin: true },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useUser();
  const path = usePathname();
  const items = NAV.filter((i) => (!i.staff || user.isStaff) && (!i.admin || user.isAdmin));
  const mobileItems = items.filter((i) => i.mobile);

  return (
    <div className="flex min-h-dvh">
      {/* Boční navigace – desktop */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <Link href="/" className="flex items-center gap-3 px-5 py-5">
          <Logo />
          <div className="leading-tight">
            <div className="font-[family-name:var(--font-display)] text-base font-bold">{APP_NAME}</div>
            <div className="text-xs text-sidebar-foreground/60">{APP_SUBTITLE}</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(path, item.href)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className={cn("size-4", isActive(path, item.href) && "text-sidebar-primary")} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <UserMenu side="top" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Horní lišta */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-lg sm:px-6 lg:justify-end">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <Logo small />
            <span className="font-[family-name:var(--font-display)] font-bold">{APP_NAME}</span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <div className="lg:hidden">
              <UserMenu compact />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:pb-10">{children}</main>
      </div>

      {/* Spodní navigace – mobil */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur-lg lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {mobileItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                isActive(path, item.href) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" />
              {item.label.split(" ")[0]}
            </Link>
          ))}
          <MoreMenu items={items.filter((i) => !i.mobile)} path={path} />
        </div>
      </nav>
    </div>
  );
}

function MoreMenu({ items, path }: { items: NavItem[]; path: string }) {
  const router = useRouter();
  const active = items.some((i) => isActive(path, i.href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium outline-none",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <ClipboardCheck className="size-5" />
        Další
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        {items.map((i) => (
          <DropdownMenuItem key={i.href} onClick={() => router.push(i.href)} className="gap-2 py-2.5">
            <i.icon className="size-4" />
            {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ side = "bottom", compact }: { side?: "top" | "bottom"; compact?: boolean }) {
  const user = useUser();
  const router = useRouter();
  const signOut = async (scope: "local" | "global") => {
    await getSupabase().auth.signOut({ scope });
    router.replace("/login");
    router.refresh();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-3 rounded-lg text-left outline-none",
          compact ? "p-1" : "w-full p-2 hover:bg-sidebar-accent/60",
        )}
      >
        <UserAvatar profile={user.profile} />
        {!compact && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{fullName(user.profile)}</div>
            <div className="truncate text-xs text-sidebar-foreground/60">
              {user.roles.map((r) => ROLE_LABELS[r]).join(", ")}
            </div>
          </div>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="font-medium">{fullName(user.profile)}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profil")} className="gap-2">
          <User className="size-4" /> Můj profil
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/oznameni")} className="gap-2">
          <Bell className="size-4" /> Oznámení
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut("local")} className="gap-2">
          <LogOut className="size-4" /> Odhlásit se
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => signOut("global")} className="gap-2 text-destructive">
          <LogOut className="size-4" /> Odhlásit ze všech zařízení
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Přepnout světlý / tmavý režim"
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </button>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <span
      className={cn(
        "ice-gradient inline-flex items-center justify-center rounded-xl text-sky-100 shadow-lg shadow-sky-900/20",
        small ? "size-8" : "size-10",
      )}
    >
      <Snowflake className={small ? "size-4" : "size-5"} />
    </span>
  );
}
