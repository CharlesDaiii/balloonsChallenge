import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  const seg = Array.isArray(req.query.path) ? req.query.path.join("/") : (req.query.path || "");
  const target = `https://a.windbornesystems.com/${seg}`;

  const upstream = await fetch(target, { headers: { "user-agent": "balloons-proxy/1.0" } });

  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");

  res.setHeader("Access-Control-Allow-Origin", "*");
  const cc = "max-age=0, s-maxage=60, stale-while-revalidate=300";
  res.setHeader("Cache-Control", cc);
  res.setHeader("CDN-Cache-Control", cc);

  const body = await upstream.arrayBuffer();
  res.send(Buffer.from(body));
}