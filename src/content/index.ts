import browser from "webextension-polyfill";
import type {
  ContentMessage,
  ClassifyFromContentRequest,
  ClassifyResponse,
  FocusStats,
  FocusStatus,
} from "../shared/types";
import "./style.css";

/* ── Selectors ────────────────────────────────────────── */

const CONTENT_SELECTORS = [
  "article",
  "section",
  '[role="article"]',
  '[role="listitem"]',
  ".card",
  ".post",
  ".story",
  ".feed-item",
  ".news-item",
  ".list-item",
  ".entry",
  ".result",
  ".tweet",
  ".update",
  '[data-testid="tweet"]',
  '[data-testid="post"]',
  ".g",           // Google search result
  ".tF2Cxc",      // Google search result
  "li",
];

const NEVER_HIDE = [
  "nav",
  "header",
  "footer",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  "form",
  "input",
  "textarea",
  "select",
  "button",
  '[role="search"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  "script",
  "style",
  "link",
  "meta",
];

const MIN_TEXT = 30;
const BATCH = 5;

/* ── State ────────────────────────────────────────────── */

let active = false;
let topic = "";
let sensitivity = 50;
let processed = new WeakSet<Element>();
let observer: MutationObserver | null = null;
let stats: FocusStats = { analyzed: 0, hidden: 0, kept: 0 };

/* ── Messaging ────────────────────────────────────────── */

browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as ContentMessage;
  switch (msg.action) {
    case "analyze":
      topic = msg.topic;
      sensitivity = msg.sensitivity;
      startAnalysis();
      break;
    case "disable":
      stopAnalysis();
      revealAll();
      break;
    case "revealAll":
      toggleReveal();
      break;
  }
});

// Auto-start if previously enabled
(async () => {
  const data = await browser.storage.local.get([
    "enabled",
    "topic",
    "sensitivity",
  ]);
  if (data.enabled && data.topic) {
    topic = data.topic as string;
    sensitivity = (data.sensitivity as number) ?? 50;
    startAnalysis();
  }
})();

/* ── Core logic ───────────────────────────────────────── */

function startAnalysis() {
  if (!topic) return;
  active = true;
  stats = { analyzed: 0, hidden: 0, kept: 0 };
  pushStats();
  processed = new WeakSet();
  clearMarkers();
  analyzeVisible();
  watchDOM();
}

function stopAnalysis() {
  active = false;
  observer?.disconnect();
  observer = null;
  setStatus("idle", "Focus mode disabled");
}

function clearMarkers() {
  for (const attr of ["data-focus-hidden", "data-focus-kept", "data-focus-scanning"]) {
    document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  }
  document.body?.removeAttribute("data-focus-reveal");
}

function revealAll() {
  clearMarkers();
  stats = { analyzed: 0, hidden: 0, kept: 0 };
  pushStats();
}

function toggleReveal() {
  if (document.body.hasAttribute("data-focus-reveal")) {
    document.body.removeAttribute("data-focus-reveal");
  } else {
    document.body.setAttribute("data-focus-reveal", "");
    setTimeout(() => document.body.removeAttribute("data-focus-reveal"), 5000);
  }
}

/* ── DOM helpers ──────────────────────────────────────── */

function cleanText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("script, style, noscript").forEach((s) => s.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function gatherElements(): Element[] {
  const selectorStr = CONTENT_SELECTORS.join(", ");
  const neverStr = NEVER_HIDE.join(", ");
  const elements: Element[] = [];

  document.querySelectorAll(selectorStr).forEach((el) => {
    if (processed.has(el)) return;
    if (el.closest(neverStr) || el.matches(neverStr)) return;

    const rect = el.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 20) return;
    if (cleanText(el).length < MIN_TEXT) return;

    // Deduplicate: skip if a parent is already collected
    if (elements.some((e) => e.contains(el))) return;

    // Remove children subsumed by this element
    for (let i = elements.length - 1; i >= 0; i--) {
      if (el.contains(elements[i])) elements.splice(i, 1);
    }

    elements.push(el);
  });

  return elements;
}

/* ── Analysis ─────────────────────────────────────────── */

async function analyzeVisible() {
  if (!active) return;

  const elements = gatherElements();
  if (elements.length === 0) {
    setStatus("active", "No content blocks found to analyze");
    return;
  }

  setStatus("loading", `Analyzing ${elements.length} elements...`);

  for (let i = 0; i < elements.length; i += BATCH) {
    if (!active) return;

    const batch = elements.slice(i, i + BATCH);
    const texts = batch.map(cleanText);
    batch.forEach((el) => el.setAttribute("data-focus-scanning", "true"));

    try {
      const request: ClassifyFromContentRequest = {
        action: "classifyFromContent",
        texts,
        topic,
        sensitivity,
      };

      const response = (await browser.runtime.sendMessage(
        request,
      )) as ClassifyResponse;

      batch.forEach((el) => el.removeAttribute("data-focus-scanning"));

      if (response?.success && response.results) {
        response.results.forEach((result, idx) => {
          const el = batch[idx];
          processed.add(el);
          stats.analyzed++;

          if (result.relevant) {
            el.setAttribute("data-focus-kept", "true");
            el.removeAttribute("data-focus-hidden");
            stats.kept++;
          } else {
            el.setAttribute("data-focus-hidden", "true");
            el.removeAttribute("data-focus-kept");
            stats.hidden++;
          }
        });
      }
    } catch (err) {
      batch.forEach((el) => el.removeAttribute("data-focus-scanning"));
      console.warn("[AI Focus Mode]", err);
      setStatus(
        "error",
        `Error: ${err instanceof Error ? err.message : "classification failed"}`,
      );
      // Continue with remaining batches rather than stopping
    }

    pushStats();
    await new Promise((r) => setTimeout(r, 50));
  }

  setStatus(
    "active",
    `Done — ${stats.hidden} distractions hidden, ${stats.kept} kept`,
  );
}

/* ── MutationObserver (infinite scroll / SPA) ─────────── */

function watchDOM() {
  observer?.disconnect();

  let debounce: ReturnType<typeof setTimeout>;
  observer = new MutationObserver(() => {
    if (!active) return;
    clearTimeout(debounce);
    debounce = setTimeout(analyzeVisible, 1000);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/* ── Storage shortcuts ────────────────────────────────── */

function setStatus(state: FocusStatus["state"], message: string) {
  browser.storage.local.set({ focusStatus: { state, message } });
}

function pushStats() {
  browser.storage.local.set({ focusStats: { ...stats } });
}
