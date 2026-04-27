import browser from "webextension-polyfill";
import type {
  FocusStatus,
  FocusStats,
  DownloadProgress,
  DownloadFileProgress,
  ContentMessage,
} from "../shared/types";

/* ── DOM refs ─────────────────────────────────────────── */

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const topicInput = $<HTMLInputElement>("topic");
const sensitivitySlider = $<HTMLInputElement>("sensitivity");
const sensitivityValue = $("sensitivity-value");
const enabledToggle = $<HTMLInputElement>("enabled");
const statusDot = $("status-dot");
const statusText = $("status-text");
const statAnalyzed = $("stat-analyzed");
const statHidden = $("stat-hidden");
const statKept = $("stat-kept");
const btnReveal = $("btn-reveal");
const downloadsSection = $("downloads-section");
const downloadsToggle = $("downloads-toggle");
const downloadsList = $("downloads-list");
const downloadsBadge = $("downloads-badge");

/* ── Load saved state ─────────────────────────────────── */

const data = await browser.storage.local.get([
  "topic",
  "sensitivity",
  "enabled",
]);
if (data.topic) topicInput.value = data.topic as string;
if (data.sensitivity != null) {
  sensitivitySlider.value = String(data.sensitivity);
  sensitivityValue.textContent = `${data.sensitivity}%`;
}
if (data.enabled) enabledToggle.checked = true;
refreshStatusFromStorage();

/* ── Storage change listener ──────────────────────────── */

browser.storage.onChanged.addListener((changes) => {
  if (changes.focusStatus?.newValue)
    applyStatus(changes.focusStatus.newValue as FocusStatus);
  if (changes.focusStats?.newValue)
    applyStats(changes.focusStats.newValue as FocusStats);
  if (changes.downloadProgress?.newValue)
    renderDownloads(changes.downloadProgress.newValue as DownloadProgress);
});

/* ── Helpers ──────────────────────────────────────────── */

async function refreshStatusFromStorage() {
  const d = await browser.storage.local.get([
    "focusStatus",
    "focusStats",
    "downloadProgress",
  ]);
  if (d.focusStatus) applyStatus(d.focusStatus as FocusStatus);
  if (d.focusStats) applyStats(d.focusStats as FocusStats);
  if (d.downloadProgress)
    renderDownloads(d.downloadProgress as DownloadProgress);
}

function applyStatus(status: FocusStatus) {
  statusDot.className = "status-dot";
  if (status.state !== "idle") statusDot.classList.add(status.state);
  statusText.textContent =
    status.message || "Idle — enter a topic and enable";
}

function applyStats(stats: FocusStats) {
  statAnalyzed.textContent = String(stats.analyzed ?? 0);
  statHidden.textContent = String(stats.hidden ?? 0);
  statKept.textContent = String(stats.kept ?? 0);
}

/* ── Downloads panel ──────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function renderDownloads(progress: DownloadProgress) {
  const files = Object.values(progress.files);

  // Clear list
  downloadsList.textContent = "";

  if (files.length === 0) {
    downloadsList.appendChild(
      el("div", "downloads-empty", "No downloads yet — enable focus mode to start."),
    );
    downloadsBadge.textContent = "";
    downloadsBadge.className = "downloads-badge";
    return;
  }

  const isFinished = (f: DownloadFileProgress) =>
    f.status === "done" || f.status === "cached";
  const allDone = files.every(isFinished);
  const doneCount = files.filter(isFinished).length;
  const allCached = files.every((f) => f.status === "cached");

  if (allDone) {
    downloadsBadge.textContent = allCached ? "Cached" : "Done";
    downloadsBadge.className = `downloads-badge ${allCached ? "all-cached" : "all-done"}`;
  } else {
    downloadsBadge.textContent = `${doneCount}/${files.length}`;
    downloadsBadge.className = "downloads-badge in-progress";
    if (!downloadsSection.classList.contains("open")) {
      downloadsSection.classList.add("open");
    }
  }

  for (const f of files) {
    downloadsList.appendChild(buildFileRow(f));
  }
}

function buildFileRow(f: DownloadFileProgress): HTMLElement {
  const row = el("div", "dl-item");

  const finished = f.status === "done" || f.status === "cached";

  // Icon
  const icon = el("span");
  if (finished) {
    icon.className = "dl-icon done";
    icon.textContent = "\u2714";
  } else if (f.status === "downloading") {
    icon.className = "dl-icon downloading";
    icon.textContent = "\u25CF";
  } else {
    icon.className = "dl-icon pending";
    icon.textContent = "\u25CB";
  }
  row.appendChild(icon);

  // Details column
  const details = el("div", "dl-details");

  const name = el("div", "dl-name", f.file);
  name.title = f.file;
  details.appendChild(name);

  const barWrap = el("div", "dl-bar-wrap");
  const bar = el("div", `dl-bar ${finished ? "done" : "downloading"}`);
  bar.style.width = `${f.progress}%`;
  barWrap.appendChild(bar);
  details.appendChild(barWrap);

  if (f.total > 0 && f.status !== "cached") {
    details.appendChild(
      el("div", "dl-size", `${formatBytes(f.loaded)} / ${formatBytes(f.total)}`),
    );
  }

  row.appendChild(details);

  // Status label
  const pct = el("span");
  if (f.status === "cached") {
    pct.className = "dl-percent cached";
    pct.textContent = "Cached";
  } else if (f.status === "done") {
    pct.className = "dl-percent done";
    pct.textContent = "Done";
  } else {
    pct.className = "dl-percent";
    pct.textContent = `${f.progress}%`;
  }
  row.appendChild(pct);

  return row;
}

// Toggle collapse
downloadsToggle.addEventListener("click", () => {
  downloadsSection.classList.toggle("open");
});

/* ── Tab messaging ────────────────────────────────────── */

async function sendToActiveTab(message: ContentMessage) {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (tabs[0]?.id) {
    browser.tabs.sendMessage(tabs[0].id, message).catch(() => {});
  }
}

function notifyContentScript() {
  const topic = topicInput.value.trim();
  if (!topic) return;
  sendToActiveTab({
    action: "analyze",
    topic,
    sensitivity: parseInt(sensitivitySlider.value),
  });
}

/* ── Event handlers ───────────────────────────────────── */

let topicTimer: ReturnType<typeof setTimeout>;
topicInput.addEventListener("input", () => {
  clearTimeout(topicTimer);
  topicTimer = setTimeout(() => {
    browser.storage.local.set({ topic: topicInput.value.trim() });
    if (enabledToggle.checked && topicInput.value.trim()) {
      notifyContentScript();
    }
  }, 500);
});

sensitivitySlider.addEventListener("input", () => {
  const val = sensitivitySlider.value;
  sensitivityValue.textContent = `${val}%`;
  browser.storage.local.set({ sensitivity: parseInt(val) });
  if (enabledToggle.checked) notifyContentScript();
});

enabledToggle.addEventListener("change", () => {
  const on = enabledToggle.checked;
  browser.storage.local.set({ enabled: on });

  if (on && topicInput.value.trim()) {
    notifyContentScript();
  } else if (!on) {
    browser.storage.local.set({
      focusStatus: { state: "idle", message: "Idle — enter a topic and enable" },
      focusStats: { analyzed: 0, hidden: 0, kept: 0 },
    });
    sendToActiveTab({ action: "disable" });
  }
});

btnReveal.addEventListener("click", () => {
  sendToActiveTab({ action: "revealAll" });
});
