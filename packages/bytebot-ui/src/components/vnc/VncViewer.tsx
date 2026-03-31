"use client";

import type {
  Button,
  ComputerAction,
  Coordinates,
  DragMouseAction,
  ScrollAction,
  TypeKeysAction,
  TypeTextAction,
} from "@bytebot/shared";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";

interface VncViewerProps {
  viewOnly?: boolean;
}

type ViewerState = "loading" | "connected" | "disconnected" | "error";

type DragState = {
  button: Button;
  hasMoved: boolean;
  path: Coordinates[];
  pointerId: number;
  startX: number;
  startY: number;
};

const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 960;
const CLICK_DEBOUNCE_MS = 220;
const DRAG_THRESHOLD_PX = 8;
const TYPE_DEBOUNCE_MS = 350;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function mapMouseButton(button: number): Button {
  switch (button) {
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "left";
  }
}

function getHoldKeys(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return [
    event.altKey ? "alt" : undefined,
    event.ctrlKey ? "ctrl" : undefined,
    event.shiftKey ? "Shift" : undefined,
    event.metaKey ? "Super" : undefined,
  ].filter((key): key is string => Boolean(key));
}

function mapKeyboardKey(key: string) {
  switch (key) {
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "Control":
      return "ctrl";
    case "Meta":
      return "Super";
    case "Alt":
      return "alt";
    case " ":
      return "Space";
    default:
      return key;
  }
}

export function VncViewer({ viewOnly = true }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const refreshFallbackScreenshotRef = useRef<(() => Promise<void>) | null>(
    null,
  );
  const dragStateRef = useRef<DragState | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreNextClickRef = useRef(false);
  const typingBufferRef = useRef("");
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [VncComponent, setVncComponent] = useState<any>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>("loading");
  const [statusMessage, setStatusMessage] = useState(
    "Connexion au bureau virtuel...",
  );
  const [fallbackImage, setFallbackImage] = useState<string | null>(null);
  const [secureContextRequired, setSecureContextRequired] = useState(false);

  function scheduleFallbackRefresh() {
    if (!refreshFallbackScreenshotRef.current) return;

    for (const delay of [150, 700]) {
      window.setTimeout(() => {
        void refreshFallbackScreenshotRef.current?.();
      }, delay);
    }
  }

  useEffect(() => {
    import("react-vnc")
      .then(({ VncScreen }) => {
        setVncComponent(() => VncScreen);
      })
      .catch((error) => {
        console.error("Failed to load VNC viewer", error);
        setViewerState("error");
        setStatusMessage("Le viewer VNC n'a pas pu etre charge.");
      });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.isSecureContext) {
      setSecureContextRequired(true);
      setViewerState("error");
      setStatusMessage(
        "Le bureau live requiert HTTPS/WSS. Rechargez cette page via https://.",
      );
      setWsUrl(null);
      return;
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    setWsUrl(`${proto}://${window.location.host}/api/proxy/websockify`);
  }, []);

  useEffect(() => {
    if (viewerState === "connected") {
      setFallbackImage(null);
      refreshFallbackScreenshotRef.current = null;
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

    refreshFallbackScreenshotRef.current = loadFallbackScreenshot;

    const timeoutId = setTimeout(() => {
      void loadFallbackScreenshot();
      intervalId = setInterval(() => {
        void loadFallbackScreenshot();
      }, 3000);
    }, 4000);

    return () => {
      isCancelled = true;
      refreshFallbackScreenshotRef.current = null;
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [viewerState]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  function mapClientCoordinates(clientX: number, clientY: number) {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return null;
    }

    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);

    return {
      x: Math.round((x / rect.width) * DESKTOP_WIDTH),
      y: Math.round((y / rect.height) * DESKTOP_HEIGHT),
    } satisfies Coordinates;
  }

  async function postBrowserAction(action: ComputerAction) {
    try {
      const response = await fetch("/api/proxy/desktop/browser-action", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(action),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || `HTTP ${response.status}`);
      }

      if (viewerState !== "connected") {
        scheduleFallbackRefresh();
      }
    } catch (error) {
      console.error("Failed to relay browser action", action, error);
      setStatusMessage("La prise en main n'a pas pu etre relayee au desktop.");
    }
  }

  function flushTypingBuffer() {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    const text = typingBufferRef.current;
    if (!text) return;

    typingBufferRef.current = "";
    const action: TypeTextAction = {
      action: "type_text",
      text,
    };
    void postBrowserAction(action);
  }

  function bufferPrintableKey(text: string) {
    typingBufferRef.current += text;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      flushTypingBuffer();
    }, TYPE_DEBOUNCE_MS);
  }

  function scheduleClick(
    button: Button,
    clickCount: number,
    coordinates: Coordinates,
    holdKeys: string[],
  ) {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      flushTypingBuffer();
      void postBrowserAction({
        action: "click_mouse",
        button,
        clickCount,
        coordinates,
        holdKeys,
      });
      clickTimerRef.current = null;
    }, CLICK_DEBOUNCE_MS);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (viewOnly) return;

    const coordinates = mapClientCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;

    overlayRef.current?.focus();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragStateRef.current = {
      button: mapMouseButton(event.button),
      hasMoved: false,
      path: [coordinates],
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const coordinates = mapClientCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;

    const lastPoint = dragState.path[dragState.path.length - 1];
    if (
      !lastPoint ||
      lastPoint.x !== coordinates.x ||
      lastPoint.y !== coordinates.y
    ) {
      dragState.path.push(coordinates);
    }

    if (!dragState.hasMoved) {
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      dragState.hasMoved = Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const coordinates = mapClientCoordinates(event.clientX, event.clientY);
    if (coordinates) {
      const lastPoint = dragState.path[dragState.path.length - 1];
      if (
        !lastPoint ||
        lastPoint.x !== coordinates.x ||
        lastPoint.y !== coordinates.y
      ) {
        dragState.path.push(coordinates);
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (dragState.hasMoved && dragState.path.length > 1) {
      ignoreNextClickRef.current = true;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      flushTypingBuffer();
      const action: DragMouseAction = {
        action: "drag_mouse",
        button: dragState.button,
        path: dragState.path,
      };
      void postBrowserAction(action);
    }

    dragStateRef.current = null;
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (
      dragStateRef.current &&
      dragStateRef.current.pointerId === event.pointerId &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (viewOnly) return;
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }

    const coordinates = mapClientCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;

    event.preventDefault();
    scheduleClick(
      mapMouseButton(event.button),
      event.detail > 1 ? 2 : 1,
      coordinates,
      getHoldKeys(event),
    );
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (viewOnly) return;

    const coordinates = mapClientCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;

    event.preventDefault();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    flushTypingBuffer();
    void postBrowserAction({
      action: "click_mouse",
      button: "left",
      clickCount: 2,
      coordinates,
      holdKeys: getHoldKeys(event),
    });
  }

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    if (viewOnly) return;

    const coordinates = mapClientCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;

    event.preventDefault();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    flushTypingBuffer();
    void postBrowserAction({
      action: "click_mouse",
      button: "right",
      clickCount: 1,
      coordinates,
      holdKeys: getHoldKeys(event),
    });
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (viewOnly) return;

    const coordinates = mapClientCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;

    event.preventDefault();
    flushTypingBuffer();

    const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
    const primaryDelta = vertical ? event.deltaY : event.deltaX;
    const action: ScrollAction = {
      action: "scroll",
      coordinates,
      direction: vertical
        ? primaryDelta >= 0
          ? "down"
          : "up"
        : primaryDelta >= 0
          ? "right"
          : "left",
      scrollCount: Math.max(
        1,
        Math.min(5, Math.round(Math.abs(primaryDelta) / 120) || 1),
      ),
      holdKeys: getHoldKeys(event),
    };

    void postBrowserAction(action);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (viewOnly) return;

    const text = event.clipboardData.getData("text");
    if (!text) return;

    event.preventDefault();
    flushTypingBuffer();
    void postBrowserAction({
      action: "paste_text",
      text,
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (viewOnly) return;

    const hasCommandModifier = event.ctrlKey || event.altKey || event.metaKey;
    const key = event.key;

    if (!hasCommandModifier && key.length === 1) {
      event.preventDefault();
      bufferPrintableKey(key);
      return;
    }

    const mappedKey = mapKeyboardKey(key);
    if (!mappedKey) return;

    if (
      !hasCommandModifier &&
      (mappedKey === "Shift" ||
        mappedKey === "Alt" ||
        mappedKey === "ctrl" ||
        mappedKey === "Super")
    ) {
      return;
    }

    event.preventDefault();
    flushTypingBuffer();

    const keys = Array.from(
      new Set(
        [
          event.ctrlKey ? "ctrl" : undefined,
          event.altKey ? "alt" : undefined,
          event.metaKey ? "Super" : undefined,
          event.shiftKey &&
          mappedKey.length !== 1 &&
          mappedKey !== "Shift"
            ? "Shift"
            : undefined,
          mappedKey,
        ].filter((value): value is string => Boolean(value)),
      ),
    );

    if (keys.length === 0) return;

    const action: TypeKeysAction = {
      action: "type_keys",
      keys,
    };
    void postBrowserAction(action);
  }

  const canInteract =
    !viewOnly && (viewerState === "connected" || Boolean(fallbackImage));

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
                {secureContextRequired
                  ? canInteract
                    ? "Le flux VNC live ne demarrera pas sans HTTPS/WSS, mais vous pouvez encore interagir via l'apercu."
                    : "Le fallback screenshot peut rester disponible, mais le flux VNC live ne demarrera pas sans contexte securise."
                  : "Verifiez que `BYTEBOT_DESKTOP_VNC_URL` pointe vers un service websockify accessible."}
              </p>
            )}
          </div>
        </div>
      )}
      {VncComponent && wsUrl && (
        <VncComponent
          rfbOptions={{
            secure: wsUrl.startsWith("wss://"),
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
            setSecureContextRequired(false);
            setStatusMessage("Connecte au bureau virtuel.");
          }}
          onDisconnect={() => {
            setViewerState("disconnected");
            setStatusMessage(
              "Desktop deconnecte. Tentative de reconnexion...",
            );
          }}
          onSecurityFailure={() => {
            setViewerState("error");
            setStatusMessage(
              "La connexion au bureau virtuel a ete refusee. Verifiez HTTPS/WSS et websockify.",
            );
          }}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {canInteract && (
        <div
          ref={overlayRef}
          tabIndex={0}
          className="absolute inset-0 z-20 cursor-default outline-none"
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        />
      )}
    </div>
  );
}
