// SWR fetcher used by client components. Always routes through the
// Next.js /api/proxy/[...path] handler so the Clerk JWT is attached
// server-side (we can't call `auth()` from the browser).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function clientFetch<T>(path: string): Promise<T> {
  const url = path.startsWith("/api/proxy/")
    ? path
    : `/api/proxy${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, `${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}
