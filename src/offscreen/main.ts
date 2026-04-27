import type {
  ClassifyRequest,
  ClassifyResponse,
  ClassifyResult,
  DownloadFileProgress,
  FocusStatus,
} from "../shared/types";

// ── Connect port (the ONLY API available in offscreen docs) ──
const port = chrome.runtime.connect({ name: "offscreen-classify" });

port.onMessage.addListener(
  (msg: ClassifyRequest & { id: number }) => {
    if (msg.action !== "classify") return;

    classify(msg)
      .then((result) => {
        port.postMessage({ id: msg.id, ...result });
      })
      .catch((err) => {
        port.postMessage({
          id: msg.id,
          success: false,
          error: String(err?.message ?? err),
        });
      });
  },
);

// ── Send status/progress to background via port ──────────
// (chrome.storage is NOT available in offscreen documents)

function sendStatus(state: FocusStatus["state"], message: string) {
  port.postMessage({ type: "status", state, message });
}

function sendProgress(files: Record<string, DownloadFileProgress>) {
  port.postMessage({ type: "progress", files });
}

// ── Lazy-load Transformers.js ─────────────────────────────

type Pipeline = import("@huggingface/transformers").ZeroShotClassificationPipeline;

let classifier: Pipeline | null = null;
let loading = false;

const fileProgress: Record<string, DownloadFileProgress> = {};
const sawDownload = new Set<string>();

function onProgress(event: {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}) {
  const file = event.file ?? "unknown";

  if (event.status === "initiate") {
    fileProgress[file] = { file, progress: 0, loaded: 0, total: 0, status: "pending" };
  } else if (event.status === "download") {
    if (fileProgress[file]) fileProgress[file].status = "downloading";
  } else if (event.status === "progress") {
    if ((event.progress ?? 0) < 100) sawDownload.add(file);
    fileProgress[file] = {
      file,
      progress: Math.round(event.progress ?? 0),
      loaded: event.loaded ?? 0,
      total: event.total ?? 0,
      status: "downloading",
    };
  } else if (event.status === "done") {
    if (fileProgress[file]) {
      fileProgress[file].progress = 100;
      fileProgress[file].status = sawDownload.has(file) ? "done" : "cached";
    }
  }

  sendProgress({ ...fileProgress });
}

async function getClassifier(): Promise<Pipeline> {
  if (classifier) return classifier;

  if (loading) {
    while (loading) await new Promise((r) => setTimeout(r, 100));
    return classifier!;
  }

  loading = true;
  sendStatus("loading", "Loading AI model (first time may take a moment)...");

  // Reset download progress
  for (const key of Object.keys(fileProgress)) delete fileProgress[key];
  sawDownload.clear();
  sendProgress({});

  try {
    const { pipeline, env } = await import("@huggingface/transformers");

    env.allowLocalModels = false;
    env.useBrowserCache = true;

    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      // Override CDN paths with local WASM files (CDN is blocked by extension CSP)
      env.backends.onnx.wasm.wasmPaths = {
        mjs: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.mjs"),
        wasm: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.wasm"),
      };
    }

    classifier = (await pipeline(
      "zero-shot-classification",
      "Xenova/mobilebert-uncased-mnli",
      { progress_callback: onProgress as any },
    )) as Pipeline;

    sendStatus("active", "AI model ready");
    return classifier;
  } catch (err: any) {
    sendStatus("error", `Failed to load model: ${err.message}`);
    throw err;
  } finally {
    loading = false;
  }
}

async function classify(req: ClassifyRequest): Promise<ClassifyResponse> {
  try {
    const model = await getClassifier();
    const threshold = req.sensitivity / 100;
    const candidateLabels = [req.topic, "unrelated content"];
    const results: ClassifyResult[] = [];

    for (const text of req.texts) {
      if (!text || text.length < 15) {
        results.push({ relevant: true, score: 1 });
        continue;
      }

      const truncated = text.length > 512 ? text.slice(0, 512) : text;

      try {
        const output = await model(truncated, candidateLabels, {
          multi_label: false,
        });

        const topicIdx = output.labels.indexOf(req.topic);
        const topicScore = output.scores[topicIdx];
        results.push({ relevant: topicScore >= threshold, score: topicScore });
      } catch {
        results.push({ relevant: true, score: 1 });
      }
    }

    return { success: true, results };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
