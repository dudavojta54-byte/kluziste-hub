"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSupabase } from "./supabase/client";
import { rangeToIso } from "./dates";
import type {
  AdminDashboard,
  Announcement,
  Application,
  Availability,
  Contact,
  DocumentRow,
  LessonType,
  Location,
  Notification,
  OccurrenceFull,
  Profile,
  RewardSettings,
  Statement,
  Suggestion,
  TeamOverviewRow,
} from "./types";

const sb = () => getSupabase();

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const OCC_SELECT =
  "*, lesson_type:lesson_types(id, code, name, color), location:locations(id, name, color), assignments:instructor_assignments(id, user_id, status)";

// ---------------------------------------------------------------- číselníky
export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: () => unwrap<Location[]>(sb().from("locations").select("*").order("name")),
    staleTime: 5 * 60_000,
  });
}

export function useLessonTypes() {
  return useQuery({
    queryKey: ["lesson_types"],
    queryFn: () => unwrap<LessonType[]>(sb().from("lesson_types").select("*").order("sort_order")),
    staleTime: 5 * 60_000,
  });
}

export function useTeam() {
  return useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const [profiles, roles] = await Promise.all([
        unwrap<Profile[]>(sb().from("profiles").select("*").order("last_name")),
        unwrap<{ user_id: string; role: string }[]>(sb().from("user_roles").select("user_id, role")),
      ]);
      return profiles.map((p) => ({ ...p, roles: roles.filter((r) => r.user_id === p.id).map((r) => r.role) }));
    },
    staleTime: 60_000,
  });
}

export function useProfilesById() {
  const team = useTeam();
  const map = new Map((team.data ?? []).map((p) => [p.id, p]));
  return { map, isLoading: team.isLoading };
}

// ---------------------------------------------------------------- lekce
export function useOccurrences(from: string, to: string) {
  return useQuery({
    queryKey: ["occurrences", from, to],
    queryFn: () => {
      const r = rangeToIso(from, to);
      return unwrap<OccurrenceFull[]>(
        sb().from("lesson_occurrences").select(OCC_SELECT)
          .gte("starts_at", r.from).lt("starts_at", r.to).order("starts_at"),
      );
    },
  });
}

export function useUpcomingOccurrences(limit = 50) {
  return useQuery({
    queryKey: ["occurrences", "upcoming", limit],
    queryFn: () =>
      unwrap<OccurrenceFull[]>(
        sb().from("lesson_occurrences").select(OCC_SELECT)
          .gte("ends_at", new Date().toISOString()).eq("status", "scheduled")
          .order("starts_at").limit(limit),
      ),
  });
}

export function useOccurrence(id: string) {
  return useQuery({
    queryKey: ["occurrences", "detail", id],
    queryFn: () =>
      unwrap<OccurrenceFull & { lesson: { recurrence: string } }>(
        sb().from("lesson_occurrences").select(`${OCC_SELECT}, lesson:lessons(recurrence)`).eq("id", id).single(),
      ),
  });
}

export function useSeriesCount(lessonId: string | undefined) {
  return useQuery({
    queryKey: ["occurrences", "series", lessonId],
    enabled: !!lessonId,
    queryFn: async () => {
      const { count, error } = await sb().from("lesson_occurrences").select("id", { count: "exact", head: true })
        .eq("lesson_id", lessonId!).eq("status", "scheduled");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

export function useApplicationsFor(occurrenceId: string) {
  return useQuery({
    queryKey: ["applications", "occ", occurrenceId],
    queryFn: () =>
      unwrap<Application[]>(
        sb().from("lesson_applications").select("*").eq("occurrence_id", occurrenceId).order("created_at"),
      ),
  });
}

export function useMyApplications(userId: string) {
  return useQuery({
    queryKey: ["applications", "mine", userId],
    queryFn: () =>
      unwrap<(Application & { occurrence: OccurrenceFull })[]>(
        sb().from("lesson_applications").select(`*, occurrence:lesson_occurrences(${OCC_SELECT})`)
          .eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
      ),
  });
}

export function useOpenApplications() {
  return useQuery({
    queryKey: ["applications", "open"],
    queryFn: () =>
      unwrap<(Application & { occurrence: OccurrenceFull })[]>(
        sb().from("lesson_applications").select(`*, occurrence:lesson_occurrences!inner(${OCC_SELECT})`)
          .in("status", ["pending", "waitlisted", "cancel_requested"])
          .eq("occurrence.status", "scheduled")
          .gte("occurrence.starts_at", new Date().toISOString())
          .order("created_at"),
      ),
  });
}

export function useSuggestions(occurrenceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["suggestions", occurrenceId],
    enabled,
    queryFn: () => unwrap<Suggestion[]>(sb().rpc("suggest_instructors", { p_occurrence: occurrenceId })),
  });
}

// ---------------------------------------------------------------- výkony
export function useStatement(userId: string | undefined, period: string) {
  return useQuery({
    queryKey: ["statement", userId, period],
    enabled: !!userId,
    queryFn: () => unwrap<Statement>(sb().rpc("monthly_statement", { p_user: userId, p_period: period })),
  });
}

export function useCreditHistory(months = 6) {
  return useQuery({
    queryKey: ["credit_history", months],
    queryFn: () =>
      unwrap<{ period: string; lesson_credits: number; bonus_credits: number; hours: number }[]>(
        sb().rpc("my_credit_history", { p_months: months }),
      ),
  });
}

export function useTeamOverview(period: string, lessonType: string | null, location: string | null) {
  return useQuery({
    queryKey: ["team_overview", period, lessonType, location],
    queryFn: () =>
      unwrap<TeamOverviewRow[]>(
        sb().rpc("team_overview", { p_period: period, p_lesson_type: lessonType, p_location: location }),
      ),
  });
}

export function useAdminDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => unwrap<AdminDashboard>(sb().rpc("admin_dashboard", { p_day: null })),
    refetchInterval: 60_000,
  });
}

export function usePeriodStatus(period: string) {
  return useQuery({
    queryKey: ["period_status", period],
    queryFn: () => unwrap<string>(sb().rpc("period_status", { p_period: period })),
  });
}

export function useRewardSettings(userId: string | undefined) {
  return useQuery({
    queryKey: ["reward_settings", userId],
    enabled: !!userId,
    queryFn: () =>
      unwrap<RewardSettings[]>(
        sb().from("reward_settings").select("*").eq("user_id", userId!).order("valid_from", { ascending: false }),
      ),
  });
}

// ---------------------------------------------------------------- dostupnost
export function useAvailability(userId?: string) {
  return useQuery({
    queryKey: ["availability", userId ?? "all"],
    queryFn: () => {
      let q = sb().from("availability").select("*").order("date");
      if (userId) q = q.eq("user_id", userId);
      return unwrap<Availability[]>(q);
    },
  });
}

// ---------------------------------------------------------------- komunikace
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      unwrap<Notification[]>(
        sb().from("notifications").select("*").order("created_at", { ascending: false }).limit(60),
      ),
    refetchInterval: 120_000,
  });
}

export type AnnouncementWithReceipt = Announcement & {
  recipients: { user_id: string; read_at: string | null; acknowledged_at: string | null }[];
};

export function useAnnouncements() {
  return useQuery({
    queryKey: ["announcements"],
    queryFn: () =>
      unwrap<AnnouncementWithReceipt[]>(
        sb().from("announcements").select("*, recipients:announcement_recipients(user_id, read_at, acknowledged_at)")
          .order("created_at", { ascending: false }).limit(50),
      ),
  });
}

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: () => unwrap<Contact[]>(sb().from("contacts").select("*").order("sort_order")),
  });
}

export function useDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: () =>
      unwrap<DocumentRow[]>(
        sb().from("documents").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }),
      ),
  });
}

// ---------------------------------------------------------------- mutace
/**
 * Volání RPC funkce s toastem a invalidací cache. Chybové zprávy přicházejí
 * česky přímo z databáze (raise exception).
 */
export function useRpc<TArgs extends Record<string, unknown>, TResult = unknown>(
  fn: string,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string) } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => unwrap<TResult>(sb().rpc(fn, args)),
    onSuccess: (r) => {
      for (const key of opts.invalidate ?? DEFAULT_INVALIDATE) qc.invalidateQueries({ queryKey: key });
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

const DEFAULT_INVALIDATE: QueryKey[] = [
  ["occurrences"], ["applications"], ["dashboard"], ["suggestions"], ["statement"], ["team_overview"],
];

/** Přímý zápis do tabulky (chráněno RLS) */
export function useTableMutation<T>(
  fn: (client: ReturnType<typeof sb>, input: T) => PromiseLike<{ error: { message: string } | null }>,
  opts: { invalidate: QueryKey[]; success?: string },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: T) => {
      const { error } = await fn(sb(), input);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      for (const key of opts.invalidate) qc.invalidateQueries({ queryKey: key });
      if (opts.success) toast.success(opts.success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
