"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSupabase } from "@/lib/supabase/client";
import type { SessionUser } from "@/lib/types";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: 1 },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster richColors position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------- uživatel
const UserContext = createContext<SessionUser | null>(null);

export function UserProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <UserContext value={user}>
      <RealtimeSync userId={user.id} />
      {children}
    </UserContext>
  );
}

export function useUser() {
  const u = useContext(UserContext);
  if (!u) throw new Error("useUser musí být uvnitř UserProvider");
  const isAdmin = u.roles.includes("admin");
  const isStaff = isAdmin || u.roles.includes("coordinator");
  return { ...u, isAdmin, isStaff, isInstructor: u.roles.includes("instructor") };
}

// ---------------------------------------------------------------- realtime
const TABLE_KEYS: Record<string, string[][]> = {
  lesson_occurrences: [["occurrences"], ["dashboard"]],
  lesson_applications: [["applications"], ["occurrences"], ["dashboard"]],
  instructor_assignments: [["occurrences"], ["dashboard"], ["suggestions"]],
  attendance_records: [["statement"], ["team_overview"], ["credit_history"]],
  credit_ledger: [["statement"], ["team_overview"], ["credit_history"]],
  notifications: [["notifications"]],
  announcements: [["announcements"]],
};

/** Supabase Realtime => invalidace TanStack Query. RLS filtruje i události. */
function RealtimeSync({ userId }: { userId: string }) {
  const qc = useQueryClient();
  useEffect(() => {
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const flush = () => {
      for (const table of pending) for (const key of TABLE_KEYS[table] ?? []) qc.invalidateQueries({ queryKey: key });
      pending.clear();
    };
    const channel = supabase.channel(`sync-${userId}`);
    for (const table of Object.keys(TABLE_KEYS)) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        pending.add(table);
        clearTimeout(timer);
        timer = setTimeout(flush, 400);
      });
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [qc, userId]);
  return null;
}
