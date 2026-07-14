import { mkdir, readFile, writeFile } from 'node:fs/promises'

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const escapedHtml = JSON.stringify(html)

await mkdir(new URL('../dist/server', import.meta.url), { recursive: true })
await writeFile(
  new URL('../dist/server/index.js', import.meta.url),
  `const indexHtml = ${escapedHtml};

const assetCache = "public, max-age=31536000, immutable";

function withCache(response, pathname) {
  const headers = new Headers(response.headers);
  if (pathname.startsWith("/assets/")) headers.set("cache-control", assetCache);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const assetResponse = env?.ASSETS ? await env.ASSETS.fetch(request) : null;

    if (assetResponse && assetResponse.status !== 404) {
      return withCache(assetResponse, url.pathname);
    }

    if (url.pathname.includes(".")) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(indexHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
`,
)
