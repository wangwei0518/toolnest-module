import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { isToolNestReactSharedDependency } from "@toolnest/react-module-sdk/vite";

const hostDevSharedDependencies = [
  ["react/jsx-dev-runtime", "http://localhost:5174/src/module-system/shared-runtime/react-jsx-dev-runtime-dev.ts"],
  ["react/jsx-runtime", "http://localhost:5174/src/module-system/shared-runtime/react-jsx-runtime-dev.ts"],
  ["react-dom/client", "http://localhost:5174/src/module-system/shared-runtime/react-dom-client.ts"],
  ["react-dom", "http://localhost:5174/src/module-system/shared-runtime/react-dom-dev.ts"],
  ["react", "http://localhost:5174/src/module-system/shared-runtime/react-dev.ts"],
  ["@base-ui/react/slider", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_slider.js"],
  ["@base-ui/react/button", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_button.js"],
  ["@base-ui/react/merge-props", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_merge-props.js"],
  ["@base-ui/react/use-render", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_use-render.js"],
  ["@remixicon/react", "http://localhost:5174/node_modules/.vite/deps/@remixicon_react.js"],
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostDevSharedDependencyPlugin() {
  return {
    name: "xiaomi-rear-wallpaper-host-dev-shared-dependencies",
    apply: "serve" as const,
    enforce: "post" as const,
    transform(code: string, id: string) {
      if (
        !id.includes("/src/") &&
        !id.includes("\\src\\") &&
        !id.includes("/dev/") &&
        !id.includes("\\dev\\")
      ) return null;
      let transformed = code;
      for (const [specifier, replacement] of hostDevSharedDependencies) {
        const pattern = new RegExp(`((?:from\\s*|import\\s*\\()\\s*[\\"'])${escapeRegExp(specifier)}([\\"'])`, "g");
        transformed = transformed.replace(pattern, `$1${replacement}$2`);
      }
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), hostDevSharedDependencyPlugin()],
  define: {
    "process.env.NODE_ENV": JSON.stringify(command === "serve" ? "development" : "production"),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "use-sync-external-store/shim/with-selector": fileURLToPath(
        new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url),
      ),
      "use-sync-external-store/with-selector.js": fileURLToPath(
        new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url),
      ),
      "use-sync-external-store/with-selector": fileURLToPath(
        new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url),
      ),
      "use-sync-external-store/shim": fileURLToPath(
        new URL("./src/shims/use-sync-external-store.ts", import.meta.url),
      ),
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
  server: command === "serve" ? {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    cors: true,
    origin: "http://127.0.0.1:5175",
    hmr: { host: "127.0.0.1", port: 5175 },
  } : undefined,
}));
