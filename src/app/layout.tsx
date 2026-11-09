import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin", "latin-ext"] });
const manrope = Manrope({ variable: "--font-display", subsets: ["latin", "latin-ext"], weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Kluziště Praha | Instructor Hub", template: "%s · Instructor Hub" },
  description: "Plánování směn, lekcí, kreditů a odměn instruktorů bruslení.",
  applicationName: "Instructor Hub",
  appleWebApp: { capable: true, title: "Instructor Hub", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/pwa-icon/180" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1626" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="cs" suppressHydrationWarning className={`${inter.variable} ${manrope.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
