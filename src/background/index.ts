import browser from "webextension-polyfill";
import type {
  ClassifyFromContentRequest,
  ClassifyRequest,
  ClassifyResponse,
} from "../shared/types";

/* ── Offscreen port (direct channel, no broadcast) ────── */

let offscreenPort: chrome.runtime.Port | null = null;
let offscreenConnected: Promise<void> | null = null;
let resolveConnected: (() => void) | null = null;

let nextReqId = 1;
const pending = new Map<
  number,
  { resolve: (v: ClassifyResponse) => void; timer: ReturnType<typeof setTimeout> }
>();

// Listen for the offscreen document to connect via a named port.
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== "offscreen-classify") return;

  offscreenPort = port;
  resolveConnected?.();

  port.onMessage.addListener((msg: any) => {
    // Status updates from offscreen → write to storage
    if (msg.type === "status") {
      browser.storage.local.set({
        focusStatus: { state: msg.state, message: msg.message },
      });
      return;
    }

    // Download progress from offscreen → write to storage
    if (msg.type === "progress") {
      browser.storage.local.set({
        downloadProgress: { files: msg.files },
      });
      return;
    }

    // Classify response — match to pending request
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    entry.resolve(msg);
  });

  port.onDisconnect.addListener(() => {
    offscreenPort = null;
    offscreenConnected = null;
    resolveConnected = null;
    // Reject all pending requests
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ success: false, error: "Offscreen disconnected" });
      pending.delete(id);
    }
  });
});

/* ── Create / ensure offscreen document ───────────────── */

async function ensureOffscreen(): Promise<void> {
  // Already connected and alive
  if (offscreenPort) return;

  // Always create a fresh connection promise
  offscreenConnected = new Promise((r) => {
    resolveConnected = r;
  });

  // Check if document exists but port dropped
  const contexts = await (chrome as any).runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (contexts.length > 0) {
    // Document exists but port is gone — close and recreate
    try {
      await (chrome as any).offscreen.closeDocument();
    } catch { /* ignore */ }
  }

  try {
    await (chrome as any).offscreen.createDocument({
      url: "offscreen/index.html",
      reasons: ["WORKERS"],
      justification:
        "Run Transformers.js AI model for content classification",
    });
  } catch (err: any) {
    if (!err.message?.includes("Only a single offscreen")) throw err;
  }

  // Wait for the port to connect (max 15 s)
  await Promise.race([
    offscreenConnected,
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error("Offscreen document did not connect in time")),
        15_000,
      ),
    ),
  ]);
}

/** Send a classify request via the port and wait for the response. */
function sendClassify(request: ClassifyRequest): Promise<ClassifyResponse> {
  return new Promise((resolve) => {
    if (!offscreenPort) {
      resolve({ success: false, error: "Offscreen not connected" });
      return;
    }

    const id = nextReqId++;

    // 2-minute timeout (model download can be slow on first run)
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ success: false, error: "Classification timed out" });
    }, 120_000);

    pending.set(id, { resolve, timer });
    offscreenPort.postMessage({ ...request, id });
  });
}

/* ── Message relay: content script → offscreen ────────── */

browser.runtime.onMessage.addListener(
  (message: unknown, _sender: browser.Runtime.MessageSender) => {
    const msg = message as ClassifyFromContentRequest;
    if (msg.action !== "classifyFromContent") return;

    return (async (): Promise<ClassifyResponse> => {
      try {
        await ensureOffscreen();

        return await sendClassify({
          action: "classify",
          texts: msg.texts,
          topic: msg.topic,
          sensitivity: msg.sensitivity,
        });
      } catch (err: any) {
        browser.storage.local.set({
          focusStatus: { state: "error", message: `Error: ${err.message}` },
        });
        return { success: false, error: err.message };
      }
    })();
  },
);

/* ── Defaults on install ──────────────────────────────── */

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.set({
    topic: "",
    sensitivity: 50,
    enabled: false,
    focusStatus: { state: "idle", message: "Idle — enter a topic and enable" },
    focusStats: { analyzed: 0, hidden: 0, kept: 0 },
  });
});
