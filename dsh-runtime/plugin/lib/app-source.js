import { lookup } from "node:dns/promises";
import { get } from "node:https";

export function publicIPv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99 || b === 0 && c === 2) ||
    a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}

// Resolve once and pin the checked addresses at TLS connection time. No redirects, cookies or auth.
// IPv4-only deliberately: unavailable IPv4 fails closed instead of weakening SSRF checks.
// autoSelectFamily walks the pinned list, so one dead CDN address no longer fails every read of that host.
export function publicSourceUrl(source, query) {
  const base = new URL(source.url);
  if (typeof query !== "string" || !query.trim() || query.length > (source.type === "page" ? 2000 : 300)) throw new Error("Invalid source query");
  const url = source.type === "page" ? new URL(query) : base;
  if (source.type === "page") {
    const inPath = source.pathPrefix.endsWith("/") ? url.pathname.startsWith(source.pathPrefix) : url.pathname === source.pathPrefix;
    if (url.origin !== base.origin || url.protocol !== "https:" || url.username || url.password || url.hash || url.port || /%2f|%5c|%2e/i.test(url.pathname) || !inPath)
      throw new Error("Page URL is outside the declared source scope");
    for (const key of url.searchParams.keys()) if (/token|secret|password|api.?key|auth/i.test(key)) throw new Error("Page URLs must not contain credentials");
  } else url.searchParams.set(source.queryParam, query);
  return url;
}

export async function readPublicSource(source, query, signal) {
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const url = publicSourceUrl(source, query);
  signal.throwIfAborted();
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !publicIPv4(address))) throw new Error("Source did not resolve to public IPv4 addresses");
  return new Promise((resolve, reject) => {
    const req = get(url, { signal, autoSelectFamily: true, headers: { accept: "application/json, text/plain", "user-agent": "Bees-Apps/0.1" },
      lookup: (_host, options, done) => options.all ? done(null, addresses) : done(null, addresses[0].address, 4)
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Source returned HTTP ${res.statusCode}; redirects are not followed`)); return; }
      let bytes = 0;
      const chunks = [];
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 512_000) { req.destroy(new Error("Source response exceeds 512 KB")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ url: url.href, observedAt: new Date().toISOString(), content: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(10_000, () => req.destroy(new Error("Source timed out")));
    req.on("error", reject);
  });
}
