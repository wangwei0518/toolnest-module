import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { isToolNestReactSharedDependency } from "@toolnest/react-module-sdk/vite";

const hostDevSharedDependencies = [
  ["react/jsx-dev-runtime", "http://localhost:5174/src/module-system/shared-runtime/react-jsx-dev-runtime-dev.ts"],
  ["react/jsx-runtime", "http://localhost:5174/src/module-system/shared-runtime/react-jsx-runtime-dev.ts"],
  ["react-dom/client", "http://localhost:5174/src/module-system/shared-runtime/react-dom-client-dev.ts"],
  ["react-dom", "http://localhost:5174/src/module-system/shared-runtime/react-dom-dev.ts"],
  ["react", "http://localhost:5174/src/module-system/shared-runtime/react-dev.ts"],
  ["@tanstack/react-query", "http://localhost:5174/src/module-system/shared-runtime/tanstack-react-query-dev.ts"],
  ["@base-ui/react/alert-dialog", "http://localhost:5174/@id/@base-ui/react/alert-dialog"],
  ["@base-ui/react/button", "http://localhost:5174/@id/@base-ui/react/button"],
  ["@base-ui/react/checkbox", "http://localhost:5174/@id/@base-ui/react/checkbox"],
  ["@base-ui/react/dialog", "http://localhost:5174/@id/@base-ui/react/dialog"],
  ["@base-ui/react/input", "http://localhost:5174/@id/@base-ui/react/input"],
  ["@base-ui/react/merge-props", "http://localhost:5174/@id/@base-ui/react/merge-props"],
  ["@base-ui/react/menu", "http://localhost:5174/@id/@base-ui/react/menu"],
  ["@base-ui/react/popover", "http://localhost:5174/@id/@base-ui/react/popover"],
  ["@base-ui/react/progress", "http://localhost:5174/@id/@base-ui/react/progress"],
  ["@base-ui/react/select", "http://localhost:5174/@id/@base-ui/react/select"],
  ["@base-ui/react/separator", "http://localhost:5174/@id/@base-ui/react/separator"],
  ["@base-ui/react/switch", "http://localhost:5174/@id/@base-ui/react/switch"],
  ["@base-ui/react/tabs", "http://localhost:5174/@id/@base-ui/react/tabs"],
  ["@base-ui/react/toggle-group", "http://localhost:5174/@id/@base-ui/react/toggle-group"],
  ["@base-ui/react/toggle", "http://localhost:5174/@id/@base-ui/react/toggle"],
  ["@base-ui/react/tooltip", "http://localhost:5174/@id/@base-ui/react/tooltip"],
  ["@base-ui/react/use-render", "http://localhost:5174/@id/@base-ui/react/use-render"],
  ["@base-ui/react", "http://localhost:5174/@id/@base-ui/react"],
  ["@remixicon/react", "http://localhost:5174/@id/@remixicon/react"],
  ["react-markdown", "http://localhost:5174/@id/react-markdown"],
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostDevSharedDependencyPlugin() {
  return {
    name: "workflow-tickets-host-dev-shared-dependencies",
    apply: "serve" as const,
    enforce: "post" as const,
    transform(code: string, id: string) {
      if (
        !id.includes("/src/") &&
        !id.includes("\\src\\") &&
        !id.includes("react-day-picker") &&
        !id.includes("recharts") &&
        !id.includes("react-redux") &&
        !id.includes("embla-carousel-react")
      ) return null;
      let transformed = code;
      for (const [specifier, replacement] of hostDevSharedDependencies) {
        const pattern = new RegExp(
          `((?:from\\s*|import\\s*\\()\\s*[\\"'])${escapeRegExp(specifier)}([\\"'])`,
          "g",
        );
        transformed = transformed.replace(pattern, `$1${replacement}$2`);
      }
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), hostDevSharedDependencyPlugin()],
  base: command === "serve" ? "http://127.0.0.1:5175/" : "/",
  define: {
    "process.env.NODE_ENV": JSON.stringify(command === "serve" ? "development" : "production"),
  },
  resolve: {
    dedupe: ["react", "react-dom", "embla-carousel-react"],
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
  optimizeDeps: {
    exclude: [
      "react-day-picker",
      "recharts",
      "react-redux",
      "use-sync-external-store",
      "embla-carousel-react",
    ],
    include: [
      "recharts > @reduxjs/toolkit",
      "recharts > decimal.js-light",
      "recharts > es-toolkit",
      "recharts > eventemitter3",
      "recharts > immer",
      "recharts > react-is",
      "recharts > redux",
      "recharts > reselect",
      "recharts > tiny-invariant",
    ],
  },
  server: command === "serve" ? {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    cors: true,
    origin: "http://127.0.0.1:5175",
    hmr: { host: "127.0.0.1", port: 5175 },
  } : undefined,
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
