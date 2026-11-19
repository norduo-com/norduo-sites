import { AwsClient } from "aws4fetch";

interface Env {
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

const WIDTHS = new Set([480, 960, 1440, 1920]);
const BUCKET = "berghald-spike-media";
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

function negotiate(accept: string | null, width: number): "image/avif" | "image/webp" | "image/jpeg" {
  // AVIF output is capped at 1,200 px, so wider sizes go out as WebP.
  if (accept?.includes("image/avif") && width <= 1200) return "image/avif";
  if (accept?.includes("image/webp")) return "image/webp";
  return "image/jpeg";
}

async function lqip(env: Env, key: string) {
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error("missing");
  const [a, b] = obj.body.tee();
  const info = await env.IMAGES.info(a);
  const out = await env.IMAGES.input(b)
    .transform({ width: 32, blur: 2 })
    .output({ format: "image/webp", quality: 40 });
  const bytes = new Uint8Array(await new Response(out.image()).arrayBuffer());
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return { info, lqip: `data:image/webp;base64,${btoa(bin)}`, lqipBytes: bytes.length };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // PUT /upload/<key>: stream the original to R2, then make the LQIP with the binding.
    if (req.method === "PUT" && parts[0] === "upload") {
      const key = parts.slice(1).join("/");
      const t0 = Date.now();
      await env.MEDIA.put(key, req.body, {
        httpMetadata: { contentType: req.headers.get("content-type") ?? "application/octet-stream" },
      });
      const t1 = Date.now();
      try {
        const r = await lqip(env, key);
        return Response.json({ key, putMs: t1 - t0, lqipMs: Date.now() - t1, ...r });
      } catch (e) {
        return Response.json({ key, putMs: t1 - t0, error: String(e) }, { status: 422 });
      }
    }

    // POST /lqip/<key>: binding only, for CPU measurement.
    if (req.method === "POST" && parts[0] === "lqip") {
      try {
        return Response.json(await lqip(env, parts.slice(1).join("/")));
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 422 });
      }
    }

    // GET /img/<w>/<key>: whitelisted widths via the binding, cached with the Cache API.
    if (req.method === "GET" && parts[0] === "img") {
      const w = Number(parts[1]);
      if (!WIDTHS.has(w)) return new Response("bad width", { status: 400 });
      const key = parts.slice(2).join("/");
      const format = negotiate(req.headers.get("accept"), w);
      const cacheKey = new Request(`${url.origin}/img/${w}/${key}?f=${format}&m=${url.searchParams.get("m") ?? ""}`);
      const cache = caches.default;
      const hit = await cache.match(cacheKey);
      if (hit) {
        const h = new Response(hit.body, hit);
        h.headers.set("x-spike-cache", "HIT");
        return h;
      }
      const obj = await env.MEDIA.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      try {
        // Spike: try an untyped `metadata: "none"` in transform or output (?m=t|o).
        const m = url.searchParams.get("m");
        const tOpts = { width: w, fit: "scale-down", ...(m === "t" ? { metadata: "none" } : {}) } as ImageTransform;
        const oOpts = { format, quality: 80, ...(m === "o" ? { metadata: "none" } : {}) } as ImageOutputOptions;
        let out: ImageTransformationResult;
        if (m === "d") {
          // Draw the photo onto a fresh 1x1 PNG stretched to size, so the output carries the base's (empty) metadata.
          const [a, b] = obj.body.tee();
          const { width: iw, height: ih } = (await env.IMAGES.info(a)) as { width: number; height: number };
          const h = Math.round((ih * w) / iw);
          const png = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0));
          out = await env.IMAGES.input(new Response(png).body!)
            .transform({ width: w, height: h, fit: "squeeze" })
            .draw(env.IMAGES.input(b).transform({ width: w }), { top: 0, left: 0 })
            .output({ format, quality: 80 });
        } else {
          out = await env.IMAGES.input(obj.body).transform(tOpts).output(oOpts);
        }
        const res = out.response();
        const r = new Response(res.body, res);
        r.headers.set("cache-control", "public, max-age=31536000, immutable");
        r.headers.set("vary", "Accept");
        ctx.waitUntil(cache.put(cacheKey, r.clone()));
        r.headers.set("x-spike-cache", "MISS");
        return r;
      } catch (e) {
        return new Response(String(e), { status: 422 });
      }
    }

    // GET /orig/<key>: originals, only for the resizer's own fetch (Via: image-resizing).
    if (req.method === "GET" && parts[0] === "orig") {
      if (!/image-resizing/.test(req.headers.get("via") ?? "")) return new Response("forbidden", { status: 403 });
      const obj = await env.MEDIA.get(parts.slice(1).join("/"));
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" } });
    }

    // GET /cfimg/<w>/<key>: the same via fetch + cf.image (needs a zone with transformations on).
    if (req.method === "GET" && parts[0] === "cfimg") {
      const w = Number(parts[1]);
      if (!WIDTHS.has(w)) return new Response("bad width", { status: 400 });
      const key = parts.slice(2).join("/");
      const format = negotiate(req.headers.get("accept"), w);
      const res = await fetch(`${url.origin}/orig/${key}`, {
        cf: { image: { width: w, fit: "scale-down", metadata: "none", format: format.split("/")[1] as "avif" | "webp" | "jpeg", quality: 80 } },
      });
      const r = new Response(res.body, res);
      r.headers.set("vary", "Accept");
      return r;
    }

    // POST /sign?key=&type=&size=: presigned PUT for a direct-to-R2 video upload.
    if (req.method === "POST" && parts[0] === "sign") {
      if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.ACCOUNT_ID)
        return new Response("no S3 credentials", { status: 501 });
      const key = url.searchParams.get("key") ?? "video.mp4";
      const type = url.searchParams.get("type") ?? "video/mp4";
      const size = url.searchParams.get("size");
      const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
      const target = new URL(`https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`);
      target.searchParams.set("X-Amz-Expires", "900");
      const headers: Record<string, string> = { "content-type": type };
      if (size) headers["content-length"] = size;
      const signed = await aws.sign(new Request(target, { method: "PUT", headers }), { aws: { signQuery: true, allHeaders: true } });
      return Response.json({ url: signed.url, headers });
    }

    // POST /probe/<mode>/<key>: isolate where CPU goes.
    if (req.method === "POST" && parts[0] === "probe") {
      const mode = parts[1];
      const obj = await env.MEDIA.get(parts.slice(2).join("/"));
      if (!obj) return new Response("not found", { status: 404 });
      if (mode === "drain") return Response.json({ bytes: (await new Response(obj.body).arrayBuffer()).byteLength });
      if (mode === "info") return Response.json(await env.IMAGES.info(obj.body));
      if (mode === "lqip") {
        const out = await env.IMAGES.input(obj.body).transform({ width: 32, blur: 2 }).output({ format: "image/webp", quality: 40 });
        return out.response();
      }
      return new Response("mode?", { status: 400 });
    }

    // GET /head/<key>: post-upload check.
    if (req.method === "GET" && parts[0] === "head") {
      const h = await env.MEDIA.head(parts.slice(1).join("/"));
      return Response.json(h ? { size: h.size, type: h.httpMetadata?.contentType, etag: h.etag } : null);
    }

    return new Response("spike", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
