/* ── Storage ───────────────────────────────────────────── */

export interface FocusSettings {
  topic: string;
  sensitivity: number;
  enabled: boolean;
}

export interface FocusStatus {
  state: "idle" | "loading" | "active" | "error";
  message: string;
}

export interface FocusStats {
  analyzed: number;
  hidden: number;
  kept: number;
}

export interface DownloadFileProgress {
  file: string;
  progress: number;   // 0–100
  loaded: number;     // bytes
  total: number;      // bytes
  status: "pending" | "downloading" | "done" | "cached";
}

export interface DownloadProgress {
  /** Keyed by filename */
  files: Record<string, DownloadFileProgress>;
}

export interface StorageData extends FocusSettings {
  focusStatus: FocusStatus;
  focusStats: FocusStats;
  downloadProgress: DownloadProgress;
}

/* ── Messages ─────────────────────────────────────────── */

export interface ClassifyRequest {
  action: "classify";
  texts: string[];
  topic: string;
  sensitivity: number;
}

export interface ClassifyFromContentRequest {
  action: "classifyFromContent";
  texts: string[];
  topic: string;
  sensitivity: number;
}

export interface ClassifyResult {
  relevant: boolean;
  score: number;
}

export interface ClassifyResponse {
  success: boolean;
  results?: ClassifyResult[];
  error?: string;
}

export interface AnalyzeMessage {
  action: "analyze";
  topic: string;
  sensitivity: number;
}

export interface DisableMessage {
  action: "disable";
}

export interface RevealMessage {
  action: "revealAll";
}

export type ContentMessage = AnalyzeMessage | DisableMessage | RevealMessage;
