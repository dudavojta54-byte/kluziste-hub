"use client";

import { ExternalLink, FileText, Paperclip, Pin, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, Field, LoadingList, PageHeader, Spinner } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/format";
import { useDocuments, useTableMutation } from "@/lib/queries";
import { getSupabase } from "@/lib/supabase/client";

export default function InfoPage() {
  const user = useUser();
  const docs = useDocuments();
  const remove = useTableMutation<string>((sb, id) => sb.from("documents").delete().eq("id", id), { invalidate: [["documents"]], success: "Smazáno." });

  const open = async (path: string) => {
    const { data, error } = await getSupabase().storage.from("documents").createSignedUrl(path, 300);
    if (error || !data) return toast.error("Soubor se nepodařilo otevřít.");
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const groups = new Map<string, NonNullable<typeof docs.data>>();
  for (const d of docs.data ?? []) groups.set(d.category, [...(groups.get(d.category) ?? []), d]);

  return (
    <>
      <PageHeader title="Provozní informace" description="Pravidla, postupy a dokumenty pro instruktory" actions={user.isAdmin && <NewDocument />} />
      {docs.isLoading ? <LoadingList /> : groups.size === 0 ? <EmptyState icon={FileText} title="Zatím žádné dokumenty" /> : (
        <div className="space-y-8">
          {[...groups.entries()].map(([cat, list]) => (
            <section key={cat}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((d) => (
                  <Card key={d.id} className="gap-2 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="flex items-center gap-2 font-semibold">{d.pinned && <Pin className="size-4 text-primary" />}{d.title}</h3>
                      {user.isAdmin && (
                        <Button variant="ghost" size="icon-sm" aria-label="Smazat" onClick={() => confirm("Smazat dokument?") && remove.mutate(d.id)}><Trash2 /></Button>
                      )}
                    </div>
                    {d.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{d.body}</p>}
                    <div className="flex flex-wrap gap-2">
                      {d.url && <Button variant="outline" size="sm" render={<a href={d.url} target="_blank" rel="noopener noreferrer" />}><ExternalLink /> Otevřít odkaz</Button>}
                      {d.storage_path && <Button variant="outline" size="sm" onClick={() => open(d.storage_path!)}><Paperclip /> Stáhnout soubor</Button>}
                    </div>
                    <div className="text-xs text-muted-foreground">Aktualizováno {fmtDate(d.created_at)}</div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function NewDocument() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", category: "Provoz", body: "", url: "", pinned: false });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useTableMutation<Record<string, unknown>>((sb, v) => sb.from("documents").insert(v), { invalidate: [["documents"]], success: "Dokument přidán." });

  const submit = async () => {
    setBusy(true);
    let storage_path: string | null = null;
    if (file) {
      const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_");
      storage_path = `${crypto.randomUUID()}/${safe}`;
      const { error } = await getSupabase().storage.from("documents").upload(storage_path, file);
      if (error) { setBusy(false); return toast.error(error.message); }
    }
    if (f.url && !/^https?:\/\//.test(f.url)) { setBusy(false); return toast.error("Odkaz musí začínat http(s)://"); }
    await save.mutateAsync({ title: f.title, category: f.category, body: f.body || null, url: f.url || null, pinned: f.pinned, storage_path })
      .then(() => { setOpen(false); setF({ title: "", category: "Provoz", body: "", url: "", pinned: false }); setFile(null); }).catch(() => {});
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus /> Přidat</Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Nový dokument / informace</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Název"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Kategorie"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Text"><Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Field label="Odkaz (nepovinné)"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></Field>
          <Field label="Soubor (nepovinné)"><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.pinned} onCheckedChange={(c) => setF({ ...f, pinned: Boolean(c) })} /> Připnout nahoru</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
          <Button disabled={!f.title.trim() || busy} onClick={submit}>{busy && <Spinner />} Uložit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
