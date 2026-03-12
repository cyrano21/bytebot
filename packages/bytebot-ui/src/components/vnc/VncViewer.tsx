"use client";

import Image from "next/image";
import React, { useRef, useEffect, useState } from "react";

interface VncViewerProps {
  viewOnly?: boolean;
}

type ViewerState = "loading" | "connected" | "disconnected" | "error";

export function VncViewer({ viewOnly = true }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [VncComponent, setVncComponent] = useState<any>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>("loading");
  const [statusMessage, setStatusMessage] = useState(
    "Connexion au bureau virtuel...",
  );
  const [fallbackImage, setFallbackImage] = useState<string | null>(null);

  useEffect(() => {
    // Dynamically import the VncScreen component only on the client side
    import("react-vnc")
      .then(({ VncScreen }) => {
        setVncComponent(() => VncScreen);
      })
      .catch((error) => {
        console.error("Failed to load VNC viewer", error);
        setViewerState("error");
        setStatusMessage("Le viewer VNC n'a pas pu etre charge.");
      });
  }, [viewOnly]);

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR safety‑net
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    setWsUrl(`${proto}://${window.location.host}/api/proxy/websockify`);

    const params = new URLSearchParams({
      host: window.location.hostname,
      port: window.location.port,
      path: "api/proxy/websockify",
      resize: "scale",
      autoconnect: "true",
      reconnect: "true",
      reconnect_delay: "3000",
      view_only: viewOnly ? "true" : "false",
    });
    setInteractiveUrl(`/api/proxy/novnc/vnc_lite.html?${params.toString()}`);
  }, [viewOnly]);

  useEffect(() => {
    if (viewerState === "connected") {
      setFallbackImage(null);
      return;
    }

    let isCancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadFallbackScreenshot = async () => {
      try {
        const response = await fetch("/api/proxy/desktop/screenshot", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { image?: string };
        if (!payload.image || isCancelled) return;

        setFallbackImage(`data:image/png;base64,${payload.image}`);
        if (viewerState === "loading") {
          setStatusMessage("Apercu du bureau charge en attendant la vue live.");
        }
      } catch {
        if (isCancelled) return;

        setStatusMessage("Connexion au bureau virtuel en cours...");
      }
    };

    const timeoutId = setTimeout(() => {
      void loadFallbackScreenshot();
      intervalId = setInterval(() => {
        void loadFallbackScreenshot();
      }, 3000);
    }, 4000);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [viewerState]);

  if (!viewOnly && interactiveUrl) {
    return (
      <div ref={containerRef} className="relative h-full w-full bg-black">
        <iframe
          key={interactiveUrl}
          src={interactiveUrl}
          title="Interactive virtual desktop"
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full bg-black">
      {fallbackImage && viewerState !== "connected" && (
        <Image
          src={fallbackImage}
          alt="Desktop fallback preview"
          fill
          unoptimized
          className="absolute inset-0 object-contain"
        />
      )}
      {(viewerState === "loading" ||
        viewerState === "disconnected" ||
        viewerState === "error") && (
        <div
          className={`absolute z-10 flex px-6 text-center text-sm text-white ${
            fallbackImage
              ? "inset-x-0 bottom-0 justify-center pb-4"
              : "inset-0 items-center justify-center bg-neutral-950/80"
          }`}
        >
          <div
            className={`max-w-md rounded-xl ${
              fallbackImage ? "bg-neutral-950/75 px-4 py-3" : ""
            }`}
          >
            <p className="font-medium">{statusMessage}</p>
            {viewerState !== "loading" && (
              <p className="mt-2 text-xs text-neutral-300">
                Verifiez que `BYTEBOT_DESKTOP_VNC_URL` pointe vers un service
                websockify accessible.
              </p>
            )}
          </div>
        </div>
      )}
      {VncComponent && wsUrl && (
        <VncComponent
          rfbOptions={{
            secure: false,
            shared: true,
            wsProtocols: ["binary"],
          }}
          key={viewOnly ? "view-only" : "interactive"}
          url={wsUrl}
          autoConnect
          retryDuration={3000}
          scaleViewport
          viewOnly={viewOnly}
          background="#000000"
          onConnect={() => {
            setViewerState("connected");
            setStatusMessage("Connecte au bureau virtuel.");
          }}
          onDisconnect={() => {
            setViewerState("disconnected");
            setStatusMessage("Connexion au bureau virtuel interrompue.");
          }}
          onSecurityFailure={() => {
            setViewerState("error");
            setStatusMessage(
              "La connexion au bureau virtuel a ete refusee par le serveur.",
            );
          }}
          style={{ width: "100%", height: "100%" }}
        />
      )}
    </div>
  );
}
