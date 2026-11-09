import { WifiOff } from "lucide-react";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff className="size-10 text-muted-foreground" />
      <h1 className="text-xl font-bold">Jste offline</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        Rozvrh a přihlášky vyžadují připojení, aby byly vždy aktuální. Zkuste to znovu, až budete online.
      </p>
    </div>
  );
}
