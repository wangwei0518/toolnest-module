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
  ["lucide-react", "http://localhost:5174/node_modules/.vite/deps/lucide-react.js"],
  ["@tanstack/react-query", "http://localhost:5174/src/module-system/shared-runtime/tanstack-react-query-dev.ts"],
  ["@base-ui/react/alert-dialog", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_alert-dialog.js"],
  ["@base-ui/react/button", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_button.js"],
  ["@base-ui/react/checkbox", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_checkbox.js"],
  ["@base-ui/react/collapsible", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_collapsible.js"],
  ["@base-ui/react/dialog", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_dialog.js"],
  ["@base-ui/react/input", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_input.js"],
  ["@base-ui/react/merge-props", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_merge-props.js"],
  ["@base-ui/react/menu", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_menu.js"],
  ["@base-ui/react/popover", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_popover.js"],
  ["@base-ui/react/progress", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_progress.js"],
  ["@base-ui/react/select", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_select.js"],
  ["@base-ui/react/separator", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_separator.js"],
  ["@base-ui/react/switch", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_switch.js"],
  ["@base-ui/react/tabs", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_tabs.js"],
  ["@base-ui/react/toggle-group", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_toggle-group.js"],
  ["@base-ui/react/toggle", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_toggle.js"],
  ["@base-ui/react/tooltip", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_tooltip.js"],
  ["@base-ui/react/use-render", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react_use-render.js"],
  ["@base-ui/react", "http://localhost:5174/node_modules/.vite/deps/@base-ui_react.js"],
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostDevSharedDependencyPlugin() {
  return {
    name: "python-runner-host-dev-shared-dependencies",
    apply: "serve" as const,
    enforce: "post" as const,
    transform(code: string, id: string) {
      if (!id.includes("/src/") && !id.includes("\\src\\")) return null;
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
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "use-sync-external-store/shim/with-selector": fileURLToPath(
        new URL(
          "./src/shims/use-sync-external-store-with-selector.ts",
          import.meta.url,
        ),
      ),
      "use-sync-external-store/shim": fileURLToPath(
        new URL("./src/shims/use-sync-external-store.ts", import.meta.url),
      ),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      command === "serve" ? "development" : "production",
    ),
  },
  server: command === "serve" ? {
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    cors: true,
    origin: "http://127.0.0.1:5176",
    hmr: { host: "127.0.0.1", port: 5176 },
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
        assetFileNames: "style.css",
      },
    },
  },
}));
