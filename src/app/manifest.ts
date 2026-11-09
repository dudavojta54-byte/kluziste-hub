import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kluziště Praha | Instructor Hub",
    short_name: "Instructor Hub",
    description: "Směny, lekce, kredity a odměny instruktorů bruslení",
    lang: "cs",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1626",
    theme_color: "#0f1626",
    categories: ["productivity", "sports"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Volné lekce", url: "/lekce?filtr=volne" },
      { name: "Kalendář", url: "/kalendar" },
      { name: "Výkazy", url: "/vykazy" },
    ],
  };
}
