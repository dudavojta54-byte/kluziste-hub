import type { Metadata } from "next";

export const metadata: Metadata = { title: "Příručka instruktora" };

/**
 * Příručka instruktora bruslení – samostatný dokument (public/prirucka.html)
 * vložený do aplikace. Soubor je chráněný přihlášením (proxy).
 */
export default function HandbookPage() {
  return (
    <div className="-mx-4 -mt-5 -mb-28 sm:-mx-6 sm:-mt-7 lg:-mb-10">
      <iframe
        src="/prirucka.html"
        title="Příručka instruktora bruslení"
        className="block h-[calc(100dvh-3.5rem-4.5rem)] w-full border-0 lg:h-[calc(100dvh-3.5rem)]"
      />
    </div>
  );
}
