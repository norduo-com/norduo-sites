// Throwaway spike: per-project share image with the Images binding.
// Not production code. See RESULTS.md.
import table from "./outfit-700-widths.json";

interface Env {
  IMAGES: ImagesBinding;
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
}

const W = 1200;
const H = 630;
const PAD = 72;

// Per char, in em: [advance, xMin, yMin, yMax] (Outfit 700, from gen-assets.mjs).
const glyphs = table.widths as unknown as Record<string, [number, number, number, number]>;
const FALLBACK: [number, number, number, number] = [0.6, 0, 0, 0.7]; // unknown glyph

/** Width of a string in em, from the precomputed Outfit 700 advance table (no kerning). */
function em(s: string): number {
  let w = 0;
  for (const ch of s) w += (glyphs[ch] ?? FALLBACK)[0];
  return w;
}

/**
 * The binding places the text layer by its ink box, not its baseline.
 * Return how far ink reaches below the baseline (em, >= 0) and the left side bearing of the first glyph.
 */
function ink(s: string): { below: number; lsb: number } {
  let below = 0;
  for (const ch of s) below = Math.max(below, -(glyphs[ch] ?? FALLBACK)[2]);
  const first = [...s][0] ?? " ";
  return { below, lsb: (glyphs[first] ?? FALLBACK)[1] };
}

/** Greedy word wrap; lines never exceed maxEm unless a single word does. Max `maxLines`, last line ellipsised. */
function wrap(text: string, maxEm: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (em(next) <= maxEm || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] ?? "";
    while (last && em(`${last}…`) > maxEm) last = last.slice(0, -1).trimEnd();
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

async function asset(env: Env, origin: string, path: string): Promise<ReadableStream<Uint8Array>> {
  const res = await env.ASSETS.fetch(new URL(path, origin));
  if (!res.ok || !res.body) throw new Error(`asset ${path}: ${String(res.status)}`);
  return res.body;
}

/** Cover bytes from static assets (default) or R2 (`src=r2`), as a native stream. */
async function cover(env: Env, origin: string, q: URLSearchParams): Promise<ReadableStream<Uint8Array>> {
  const name = q.get("cover") ?? "cover.jpg";
  if (q.get("src") === "r2") {
    const obj = await env.MEDIA.get(name);
    if (!obj) throw new Error(`r2 ${name} missing`);
    return obj.body;
  }
  return asset(env, origin, `/${name}`);
}

/** Return the result directly, or (store=1) write it to R2 like publish would and return 204. */
async function finish(env: Env, q: URLSearchParams, out: ImageTransformationResult, headers: HeadersInit) {
  if (q.get("store") === "1") {
    await env.MEDIA.put(`share/spike-${q.get("i") ?? "x"}.jpg`, out.image(), {
      httpMetadata: { contentType: out.contentType() },
    });
    return new Response(null, { status: 204, headers });
  }
  return out.response({ headers });
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const q = url.searchParams;
    const fontFile = q.get("font") ?? "outfit-700.woff2";
    const fontUrl = q.get("fontUrl") ?? `${url.origin}/fonts/${fontFile}`;
    const size = Number(q.get("size") ?? "60"); // pt, per the binding's TextOptions
    const pxPerPt = Number(q.get("k") ?? "1"); // calibration: rendered px per pt
    const lineH = Number(q.get("lh") ?? "1.15");
    const fmt = (q.get("fmt") ?? "image/jpeg") as "image/jpeg" | "image/png";

    try {
      switch (url.pathname) {
        case "/noop":
          return new Response("ok");

        // Calibration: render one text layer alone and report its pixel size.
        case "/measure": {
          const text = q.get("text") ?? "Þjóðvegur";
          const out = await env.IMAGES.text(text, { font: { url: fontUrl }, size, color: "#ffffff" }).output({
            format: "image/png",
          });
          if (q.has("img")) return out.response();
          const info = await env.IMAGES.info(out.image());
          return Response.json({ text, size, predictedEm: em(text), info });
        }

        // Baseline: cover resize only, no text.
        case "/cover": {
          const out = await env.IMAGES.input(await cover(env, url.origin, q))
            .transform({ width: W, height: H, fit: "cover" })
            .output({ format: fmt, quality: 82 });
          return finish(env, q, out, { "x-spike": "cover" });
        }

        // Input only: send the cover to the binding and read metadata.
        case "/info": {
          return Response.json(await env.IMAGES.info(await cover(env, url.origin, q)));
        }

        // Full share image: cover + gradient + one .text() layer per wrapped line.
        case "/og": {
          const title = q.get("title") ?? "Hellulögn og hleðsla við sumarhús í Þingvallasveit";
          const kicker = q.get("kicker") ?? "Verkefni · Berghald";
          const maxEm = (W - 2 * PAD) / (size * pxPerPt);
          const lines = wrap(title, maxEm, Number(q.get("maxLines") ?? "3"));
          const linePx = Math.round(size * pxPerPt * lineH);

          let img = env.IMAGES.input(await cover(env, url.origin, q))
            .transform({ width: W, height: H, fit: "cover" })
            .draw(await asset(env, url.origin, "/gradient.png"), { left: 0, top: 0 });

          const px = size * pxPerPt;
          const align = q.get("align") !== "0"; // baseline + left-bearing correction
          // Draw bottom-up so the last baseline sits PAD from the bottom.
          lines.forEach((line, i) => {
            const fromBottom = lines.length - 1 - i;
            const { below, lsb } = align ? ink(line) : { below: 0, lsb: 0 };
            img = img.draw(env.IMAGES.text(line, { font: { url: fontUrl }, size, color: "#ffffff" }), {
              left: Math.round(PAD + lsb * px),
              bottom: Math.round(PAD + fromBottom * linePx - below * px),
            });
          });
          if (kicker)
            img = img.draw(
              env.IMAGES.text(kicker, {
                font: { url: `${url.origin}/fonts/outfit-600.woff2` },
                size: Math.round(size * 0.45),
                color: "#c8e6b4",
              }),
              { left: PAD, bottom: PAD + lines.length * linePx + 8 },
            );

          const out = await img.output({ format: fmt, quality: 82 });
          return finish(env, q, out, { "x-spike-lines": encodeURIComponent(JSON.stringify(lines)) });
        }
      }
      if (url.pathname.startsWith("/fonts/") || url.pathname.endsWith(".png") || url.pathname.endsWith(".jpg"))
        return env.ASSETS.fetch(req);
      return new Response("not found", { status: 404 });
    } catch (e) {
      return new Response(`error: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
