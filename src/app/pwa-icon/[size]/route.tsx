import { ImageResponse } from "next/og";

const SIZES = new Set([180, 192, 512]);

/** PNG ikony pro PWA manifest a iOS (generované, bez binárních souborů v repu). */
export async function GET(_req: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size: raw } = await ctx.params;
  const size = Number(raw);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const s = size / 512;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a6e, #0f1a33)" }}>
        <svg width={360 * s} height={360 * s} viewBox="104 104 304 304" fill="none" stroke="#7dd3fc" strokeWidth={28} strokeLinecap="round">
          <path d="M256 104v304M124 180l264 152M124 332l264-152" />
          <path d="M216 120l40 36 40-36M216 392l40-36 40 36M126 236l52-14-12-52M386 276l-52 14 12 52M126 276l52 14-12 52M386 236l-52-14 12-52" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}
