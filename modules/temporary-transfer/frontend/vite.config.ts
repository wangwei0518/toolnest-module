import { fileURLToPath, URL } from "node:url";
import { build, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { isToolNestReactSharedDependency } from "@toolnest/react-module-sdk/vite";

export default defineConfig(({ command }) => ({
  define: command === "build" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
  plugins: [react(), tailwindcss(), {
    name: "temporary-transfer-guest-bundle",
    apply: "build",
    async closeBundle() {
      await build({
        configFile: false,
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        plugins: [react(), tailwindcss()],
        resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }, dedupe: ["react", "react-dom"] },
        build: { outDir: "dist", emptyOutDir: false, lib: { entry: "src/guest.tsx", formats: ["es"], fileName: () => "guest.js", cssFileName: "guest" } },
      });
    },
  }],
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
  server: {
    cors: true,
    ...(process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_API && process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_TOKEN ? {
      proxy: {
        "/api/v1/modules/temporary-transfer": {
          target: process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_API,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/v1\/modules\/temporary-transfer/, ""),
          headers: {
            "x-toolnest-internal-token": process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_TOKEN,
            "x-toolnest-user-id": "1",
            "x-toolnest-user-is-admin": "true",
          },
        },
      },
    } : {}),
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
}));
