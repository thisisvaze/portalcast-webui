/** A model file, from the browser's cache after the first time. */
export async function download(url: string): Promise<Response> {
  const cache = await globalThis.caches?.open('live-captions').catch(() => null);
  const cached = await cache?.match(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await cache?.put(url, response.clone()).catch(() => undefined);
  return response;
}
export const bytes = async (url: string) => new Uint8Array(await (await download(url)).arrayBuffer());
