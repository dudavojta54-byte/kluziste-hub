"use client";

import { AlertCircle, CheckCircle2, Megaphone, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, Field, LoadingList, PageHeader, SectionTitle, Spinner, ToneBadge, UserAvatar } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime, fullName, relativeTime } from "@/lib/format";
import { useAnnouncements, useNotifications, useProfilesById, useRpc, useTeam, type AnnouncementWithReceipt } from "@/lib/queries";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function AnnouncementsPage() {
  const user = useUser();
  const ann = useAnnouncements();
  const notifications = useNotifications();
  const [tab, setTab] = useState<"ann" | "notif">("ann");

  return (
    <>
      <PageHeader title="Oznámení" description="Provozní oznámení týmu a vaše upozornění" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex w-fit gap-1 rounded-lg bg-muted p-0.5">
            {([["ann", "Oznámení týmu"], ["notif", "Moje upozornění"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
            ))}
          </div>
          {tab === "ann" ? (
            ann.isLoading ? <LoadingList /> : (ann.data ?? []).length === 0 ? <EmptyState icon={Megaphone} title="Zatím žádná oznámení" /> : (
              (ann.data ?? []).map((a) => <AnnouncementCard key={a.id} a={a} />)
            )
          ) : (
            <Card className="gap-0 p-0">
              {(notifications.data ?? []).length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Žádná upozornění.</p> : (
                <ul className="divide-y">
                  {notifications.data!.map((n) => (
                    <li key={n.id}>
                      <Link href={n.link ?? "#"} className={cn("block px-4 py-3 hover:bg-muted/50", !n.read_at && "bg-primary/5")}>
                        <div className="text-sm font-medium">{n.title}</div>
                        {n.body && <div className="text-sm text-muted-foreground">{n.body}</div>}
                        <div className="text-xs text-muted-foreground">{relativeTime(n.created_at)}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        {user.isStaff && <ComposeCard />}
      </div>
    </>
  );
}

function AnnouncementCard({ a }: { a: AnnouncementWithReceipt }) {
  const user = useUser();
  const { map } = useProfilesById();
  const mark = useRpc<{ p_id: string; p_acknowledge: boolean }>("mark_announcement", { invalidate: [["announcements"]] });
  const mine = a.recipients.find((r) => r.user_id === user.id);
  const acked = a.recipients.filter((r) => r.acknowledged_at).length;
  const read = a.recipients.filter((r) => r.read_at).length;

  // automaticky označit jako přečtené
  useEffect(() => {
    if (mine && !mine.read_at && !a.important) mark.mutate({ p_id: a.id, p_acknowledge: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  return (
    <Card className={cn("gap-3 p-4 sm:p-5", a.important && "border-warning/50")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {a.important && <ToneBadge tone="warning"><AlertCircle className="size-3" /> Důležité</ToneBadge>}
            {a.audience === "selected" && <ToneBadge tone="muted">Vybraným</ToneBadge>}
          </div>
          <h3 className="mt-1 text-lg font-semibold">{a.title}</h3>
          <div className="text-xs text-muted-foreground">{fullName(map.get(a.created_by))} · {fmtDateTime(a.created_at)}</div>
        </div>
      </div>
      <p className="whitespace-pre-line text-sm">{a.body}</p>
      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        {mine && a.important && (
          mine.acknowledged_at ? (
            <span className="flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="size-4" /> Potvrdili jste přečtení</span>
          ) : (
            <Button size="sm" onClick={() => mark.mutate({ p_id: a.id, p_acknowledge: true })} disabled={mark.isPending}>
              <CheckCircle2 /> Potvrdit přečtení
            </Button>
          )
        )}
        {user.isStaff && (
          <details className="ml-auto text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {a.important ? `Potvrzeno ${acked}/${a.recipients.length}` : `Přečteno ${read}/${a.recipients.length}`}
            </summary>
            <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">
              {a.recipients.map((r) => (
                <li key={r.user_id} className="flex items-center justify-between gap-4">
                  <span>{fullName(map.get(r.user_id))}</span>
                  {r.acknowledged_at ? <ToneBadge tone="success">Potvrzeno</ToneBadge> : r.read_at ? <ToneBadge tone="info">Přečteno</ToneBadge> : <ToneBadge tone="muted">Nepřečteno</ToneBadge>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

function ComposeCard() {
  const team = useTeam();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [all, setAll] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const send = useRpc<Record<string, unknown>>("send_announcement", { invalidate: [["announcements"]], success: "Oznámení odesláno." });
  const members = (team.data ?? []).filter((p) => p.is_active);

  return (
    <Card className="h-fit gap-3 p-4 sm:p-5 lg:sticky lg:top-20">
      <SectionTitle>Nové oznámení</SectionTitle>
      <Field label="Předmět"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Zpráva"><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={important} onCheckedChange={(c) => setImportant(Boolean(c))} /> Důležité – vyžadovat potvrzení přečtení</label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={all} onCheckedChange={(c) => setAll(Boolean(c))} /> Celému týmu</label>
      {!all && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
          {members.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-muted">
              <Checkbox checked={selected.includes(p.id)} onCheckedChange={(c) => setSelected(c ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
              <UserAvatar profile={p} className="size-6" /> {fullName(p)}
            </label>
          ))}
        </div>
      )}
      <Button disabled={!title.trim() || !body.trim() || (!all && selected.length === 0) || send.isPending}
        onClick={() => send.mutateAsync({ p_title: title.trim(), p_body: body.trim(), p_important: important, p_recipients: all ? null : selected })
          .then(() => { setTitle(""); setBody(""); setImportant(false); setSelected([]); }).catch(() => {})}>
        {send.isPending ? <Spinner /> : <Send />} Odeslat {all ? "všem" : `(${selected.length})`}
      </Button>
      <p className="text-xs text-muted-foreground">Příjemci dostanou upozornění v aplikaci a e-mailem (pokud ho nemají vypnutý).</p>
    </Card>
  );
}
