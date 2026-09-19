import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { isToolNestReactSharedDependency } from "@toolnest/react-module-sdk/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "use-sync-external-store/shim/with-selector": fileURLToPath(new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url)),
      "use-sync-external-store/with-selector.js": fileURLToPath(new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url)),
      "use-sync-external-store/with-selector": fileURLToPath(new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url)),
      "use-sync-external-store/shim": fileURLToPath(new URL("./src/shims/use-sync-external-store.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: isToolNestReactSharedDependency,
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "style.css" : "[name][extname]",
      },
    },
  },
});
