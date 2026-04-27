import { defineConfig } from "vite";
import { resolve } from "path";

// Separate build for the content script — must be IIFE (no ES module imports).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false, // keep the main build output
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, "src/content/index.ts"),
      formats: ["iife"],
      name: "AIFocusMode",
      fileName: () => "content.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "content.[ext]",
      },
    },
  },
});
