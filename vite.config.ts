import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        "background/serviceWorker": resolve(import.meta.dirname, "src/background/serviceWorker.ts"),
        // 内容脚本以普通脚本注入，源文件不得有运行时 import，否则会被拆出共享 chunk。
        "content/networkCapture": resolve(import.meta.dirname, "src/content/networkCapture.ts"),
        "content/captureBridge": resolve(import.meta.dirname, "src/content/captureBridge.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
