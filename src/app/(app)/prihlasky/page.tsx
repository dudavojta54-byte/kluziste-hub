"use client";

import { Check, Inbox, X } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { EmptyState, LoadingList, PageHeader, ToneBadge, TypeDot, UserAvatar } from "@/components/common";
import { activeAssigned } from "@/components/lessons/occurrence-card";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { APPLICATION_STATUS } from "@/lib/constants";
import { fmtDateTime, fmtDayLong, fmtTimeRange, fullName } from "@/lib/format";
import { useOpenApplications, useProfilesById, useRpc } from "@/lib/queries";

export default function ApplicationsPage() {
  const user = useUser();
  const apps = useOpenApplications();
  const { map } = useProfilesById();
  const approve = useRpc<{ p_id: string }>("approve_application", { success: "Přihláška schválena." });
  const reject = useRpc<{ p_id: string; p_note: string | null }>("reject_application", { success: "Přihláška zamítnuta." });
  const resolve = useRpc<{ p_id: string; p_approve: boolean; p_note: string | null }>("resolve_cancel_request", { success: "Žádost vyřízena." });

  const list = apps.data;
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof list>>();
    for (const a of list ?? []) m.set(a.occurrence_id, [...(m.get(a.occurrence_id) ?? []), a]);
    return [...m.values()].sort((a, b) => a[0].occurrence.starts_at.localeCompare(b[0].occurrence.starts_at));
  }, [list]);

  if (!user.isStaff) return <EmptyState title="Tato stránka je dostupná koordinátorům a správcům." />;

  return (
    <>
      <PageHeader title="Přihlášky" description="Schvalování přihlášek, náhradníci a žádosti o zrušení" />
      {apps.isLoading ? <LoadingList /> : groups.length === 0 ? (
        <EmptyState icon={Inbox} title="Vše vyřízeno">Žádné čekající přihlášky ani žádosti o zrušení.</EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((list) => {
            const o = list[0].occurrence;
            const assigned = activeAssigned(o).length;
            return (
              <Card key={o.id} className="gap-3 p-4 sm:p-5">
                <Link href={`/lekce/${o.id}`} className="flex flex-col gap-1 hover:text-primary sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 font-semibold"><TypeDot color={o.lesson_type.color} />{o.title}</div>
                    <div className="text-sm capitalize text-muted-foreground">{fmtDayLong(o.starts_at)}, {fmtTimeRange(o.starts_at, o.ends_at)} · {o.location.name}</div>
                  </div>
                  <ToneBadge tone={assigned >= o.required_instructors ? "success" : "warning"}>Obsazeno {assigned}/{o.required_instructors}</ToneBadge>
                </Link>
                <ul className="divide-y rounded-lg border">
                  {list.map((a) => (
                    <li key={a.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                      <div className="flex flex-1 items-center gap-3">
                        <UserAvatar profile={map.get(a.user_id)} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{fullName(map.get(a.user_id))}</div>
                          <div className="text-xs text-muted-foreground">{fmtDateTime(a.created_at)}{a.note ? ` · „${a.note}“` : ""}</div>
                        </div>
                        <ToneBadge tone={APPLICATION_STATUS[a.status].tone}>{APPLICATION_STATUS[a.status].label}</ToneBadge>
                      </div>
                      <div className="flex gap-2">
                        {a.status === "cancel_requested" ? (
                          <>
                            <Button size="sm" onClick={() => resolve.mutate({ p_id: a.id, p_approve: true, p_note: null })}><Check /> Uvolnit z lekce</Button>
                            <Button size="sm" variant="outline" onClick={() => resolve.mutate({ p_id: a.id, p_approve: false, p_note: null })}>Ponechat</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" disabled={approve.isPending || assigned >= o.required_instructors} onClick={() => approve.mutate({ p_id: a.id })}>
                              <Check /> Schválit
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { const n = prompt("Důvod zamítnutí (nepovinné):"); if (n !== null) reject.mutate({ p_id: a.id, p_note: n || null }); }}>
                              <X /> Zamítnout
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
