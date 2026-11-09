import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmLink } from "./confirm-link";

export const metadata: Metadata = { title: "Přijetí pozvánky", robots: { index: false } };

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmLink />
    </Suspense>
  );
}
