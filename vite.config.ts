import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";

/** Strip `crossorigin` attributes — they break module loading in Chrome extensions. */
function stripCrossOrigin(): Plugin {
  return {
    name: "strip-crossorigin",
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, "");
    },
  };
}

export default defineConfig({
  root: "src",
  plugins: [stripCrossOrigin()],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        "popup/index": resolve(__dirname, "src/popup/index.html"),
        "offscreen/index": resolve(__dirname, "src/offscreen/main.ts"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  publicDir: resolve(__dirname, "public"),
});
