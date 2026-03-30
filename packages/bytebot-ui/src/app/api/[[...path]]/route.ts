import { NextRequest } from "next/server";

/* -------------------------------------------------------------------- */
/* generic proxy helper                                                 */
/* -------------------------------------------------------------------- */
async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const BASE_URL = process.env.BYTEBOT_AGENT_BASE_URL;
  if (!BASE_URL) {
    return Response.json(
      { error: "BYTEBOT_AGENT_BASE_URL is not configured" },
      { status: 500 },
    );
  }
  const subPath = path.length ? `/${path.join("/")}` : "";
  const url = `${BASE_URL}/api${subPath}${req.nextUrl.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await req.text(),
    });
    const body = await res.text();

    const setCookieHeaders = res.headers.getSetCookie?.() || [];
    const responseHeaders = new Headers({
      "Content-Type": res.headers.get("content-type") || "application/json",
    });

    setCookieHeaders.forEach((cookie) => {
      responseHeaders.append("Set-Cookie", cookie);
    });

    return new Response(body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown proxy error";
    return Response.json(
      {
        error: "Failed to reach Bytebot agent",
        detail: message,
      },
      { status: 502 },
    );
  }
}

/* -------------------------------------------------------------------- */
/* route handlers                                                       */
/* -------------------------------------------------------------------- */
type PathParams = Promise<{ path?: string[] }>; // <- Promise is the key

async function handler(req: NextRequest, { params }: { params: PathParams }) {
  const { path } = await params;
  return proxy(req, path ?? []);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
