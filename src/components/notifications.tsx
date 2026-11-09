"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { relativeTime } from "@/lib/format";
import { useNotifications, useRpc } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const { data = [] } = useNotifications();
  const markRead = useRpc<{ p_ids: string[] | null }>("mark_notifications_read", { invalidate: [["notifications"]] });
  const unread = data.filter((n) => !n.read_at).length;

  return (
    <Popover>
      <PopoverTrigger
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
        aria-label={`Upozornění (${unread} nepřečtených)`}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-semibold">Upozornění</span>
          {unread > 0 && (
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => markRead.mutate({ p_ids: null })}
            >
              <CheckCheck className="size-3.5" /> Označit vše jako přečtené
            </button>
          )}
        </div>
        <ScrollArea className="max-h-[60vh]">
          {data.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Zatím žádná upozornění.</p>
          ) : (
            <ul className="divide-y">
              {data.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? "/oznameni"}
                    onClick={() => !n.read_at && markRead.mutate({ p_ids: [n.id] })}
                    className={cn("block px-4 py-3 hover:bg-muted/60", !n.read_at && "bg-primary/5")}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{n.title}</div>
                        {n.body && <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{relativeTime(n.created_at)}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
