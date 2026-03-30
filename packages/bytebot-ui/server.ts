import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createProxyServer } from "http-proxy";
import next from "next";
import { createServer } from "http";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "9992", 10);

function requireUrlEnv(
  name: string,
  allowedProtocols: string[],
): URL {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL. Received: ${value}`);
  }

  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(
      `${name} must use one of: ${allowedProtocols.join(", ")}. Received: ${url.protocol}`,
    );
  }

  return url;
}

const agentBaseUrl = requireUrlEnv("BYTEBOT_AGENT_BASE_URL", [
  "http:",
  "https:",
]);
const desktopVncUrl = requireUrlEnv("BYTEBOT_DESKTOP_VNC_URL", [
  "http:",
  "https:",
  "ws:",
  "wss:",
]);

const app = next({ dev, hostname, port });

function getDesktopHttpBaseUrl() {
  const protocol =
    desktopVncUrl.protocol === "wss:"
      ? "https:"
      : desktopVncUrl.protocol === "ws:"
        ? "http:"
        : desktopVncUrl.protocol;
  return `${protocol}//${desktopVncUrl.host}`;
}

function getDesktopWebSocketBaseUrl() {
  const protocol =
    desktopVncUrl.protocol === "https:"
      ? "wss:"
      : desktopVncUrl.protocol === "http:"
        ? "ws:"
        : desktopVncUrl.protocol;
  return `${protocol}//${desktopVncUrl.host}`;
}

function getMountedTasksProxyPath(path = "/") {
  return `/socket.io${path}`;
}

function getUpgradeTasksProxyPath(path = "/socket.io") {
  return path.replace(/^\/api\/proxy\/tasks/, "/socket.io");
}

function getDesktopProxyPath(path = "") {
  return desktopVncUrl.pathname + path.replace(/^\/api\/proxy\/websockify/, "");
}

app
  .prepare()
  .then(() => {
    const handle = app.getRequestHandler();
    const nextUpgradeHandler = app.getUpgradeHandler();

    const vncProxy = createProxyServer({ changeOrigin: true, ws: true });

    const expressApp = express();
    const server = createServer(expressApp);

    // WebSocket proxy for Socket.IO connections to backend
    const tasksProxy = createProxyMiddleware({
      target: agentBaseUrl.toString(),
      ws: true,
      changeOrigin: true,
    });
    const novncProxy = createProxyMiddleware({
      target: getDesktopHttpBaseUrl(),
      changeOrigin: true,
      pathRewrite: (path) => `/novnc${path}`,
    });

    // Apply HTTP proxies
    expressApp.use("/api/proxy/tasks", (req, res, nextMiddleware) => {
      req.url = getMountedTasksProxyPath(req.url);
      tasksProxy(req, res, nextMiddleware);
    });
    expressApp.use("/api/proxy/novnc", novncProxy);
    expressApp.get("/api/proxy/desktop/screenshot", async (_req, res) => {
      try {
        const response = await fetch(`${getDesktopHttpBaseUrl()}/computer-use`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "screenshot" }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          res.status(response.status).json({
            error: "desktop_screenshot_failed",
            details: errorText,
          });
          return;
        }

        const payload = await response.json();
        res.json(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown desktop error";
        res.status(502).json({
          error: "desktop_proxy_unavailable",
          details: message,
        });
      }
    });
    expressApp.post(
      "/api/proxy/desktop/browser-action",
      express.json({ limit: "1mb" }),
      async (req, res) => {
      try {
        const body = JSON.stringify(req.body ?? {});
        const targets = [
          `${getDesktopHttpBaseUrl()}/input-tracking/browser-action`,
          `${getDesktopHttpBaseUrl()}/computer-use`,
        ];

        for (const target of targets) {
          const response = await fetch(target, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body,
          });

          if (response.status === 404 && target.endsWith("/browser-action")) {
            continue;
          }

          const payload = await response.text();
          res.status(response.status);
          if (payload) {
            res.type(
              response.headers.get("content-type") || "application/json",
            );
            res.send(payload);
            return;
          }

          res.end();
          return;
        }

        res.status(404).json({
          error: "desktop_browser_action_unavailable",
          details: "No compatible desktop action endpoint is available.",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown desktop error";
        res.status(502).json({
          error: "desktop_browser_action_failed",
          details: message,
        });
      }
      },
    );
    expressApp.use("/api/proxy/websockify", (req, res) => {
      req.url = getDesktopProxyPath(req.url);
      vncProxy.web(req, res, {
        target: getDesktopHttpBaseUrl(),
      });
    });

    // Handle all other requests with Next.js
    expressApp.all("*", (req, res) => handle(req, res));

    // Properly upgrade WebSocket connections
    server.on("upgrade", (request, socket, head) => {
      const { pathname } = new URL(
        request.url!,
        `http://${request.headers.host}`,
      );

      if (pathname.startsWith("/api/proxy/tasks")) {
        request.url = getUpgradeTasksProxyPath(request.url);
        return tasksProxy.upgrade(request, socket as any, head);
      }

      if (pathname.startsWith("/api/proxy/websockify")) {
        request.url = getDesktopProxyPath(request.url);
        return vncProxy.ws(request, socket as any, head, {
          target: getDesktopWebSocketBaseUrl(),
        });
      }

      nextUpgradeHandler(request, socket, head);
    });

    server.listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error("Server failed to start:", err);
    process.exit(1);
  });
