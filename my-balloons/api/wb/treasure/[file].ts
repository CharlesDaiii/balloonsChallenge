import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const file = String(req.query.file || "");
  const target = `https://a.windbornesystems.com/treasure/${encodeURIComponent(file)}`;

  const r = await fetch(target);
  const buf = await r.arrayBuffer();

  res.status(r.status);
  res.setHeader("Content-Type", r.headers.get("content-type") ?? "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "max-age=0, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("CDN-Cache-Control", "max-age=0, s-maxage=60, stale-while-revalidate=300");

  res.send(Buffer.from(buf));
}