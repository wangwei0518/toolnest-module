import { fileURLToPath, URL } from "node:url";
import { build, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { isToolNestReactSharedDependency } from "@toolnest/react-module-sdk/vite";

// Explicit local development only. Release builds keep SDK external dependencies.
const hostOrigin = process.env.TOOLNEST_REACT_HOST_DEV_ORIGIN?.replace(
  /\/$/,
  "",
);
const sharedDevAliases: Record<string, string> = hostOrigin
  ? {
      react: `${hostOrigin}/src/module-system/shared-runtime/react-dev.ts`,
      "react-dom": `${hostOrigin}/src/module-system/shared-runtime/react-dom-dev.ts`,
      "react/jsx-runtime": `${hostOrigin}/src/module-system/shared-runtime/react-jsx-runtime-dev.ts`,
      "react/jsx-dev-runtime": `${hostOrigin}/src/module-system/shared-runtime/react-jsx-dev-runtime-dev.ts`,
      "react-dom/client": `${hostOrigin}/@id/react-dom/client`,
    }
  : {};
export default defineConfig(({ command }) => ({
  define:
    command === "build"
      ? { "process.env.NODE_ENV": JSON.stringify("production") }
      : {},
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "temporary-transfer-host-dev-dependencies",
      apply: "serve",
      enforce: "post",
      transform(code) {
        if (!hostOrigin) return null;
        let output = code;
        for (const [specifier, replacement] of Object.entries(
          sharedDevAliases,
        )) {
          output = output.replace(
            new RegExp(
              `((?:from\\s*|import\\s*\\()\\s*["'])${specifier}(["'])`,
              "g",
            ),
            `$1${replacement}$2`,
          );
        }
        return output === code ? null : { code: output, map: null };
      },
    },
    {
      name: "temporary-transfer-guest-bundle",
      apply: "build",
      async closeBundle() {
        await build({
          configFile: false,
          define: { "process.env.NODE_ENV": JSON.stringify("production") },
          plugins: [react(), tailwindcss()],
          resolve: {
            alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
            dedupe: ["react", "react-dom"],
          },
          build: {
            outDir: "dist",
            emptyOutDir: false,
            lib: {
              entry: "src/guest.tsx",
              formats: ["es"],
              fileName: () => "guest.js",
              cssFileName: "guest",
            },
          },
        });
      },
    },
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
    alias: [
      ...Object.entries({
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "use-sync-external-store/shim/with-selector": fileURLToPath(
          new URL(
            "./src/shims/use-sync-external-store-with-selector.ts",
            import.meta.url,
          ),
        ),
        "use-sync-external-store/with-selector.js": fileURLToPath(
          new URL(
            "./src/shims/use-sync-external-store-with-selector.ts",
            import.meta.url,
          ),
        ),
        "use-sync-external-store/with-selector": fileURLToPath(
          new URL(
            "./src/shims/use-sync-external-store-with-selector.ts",
            import.meta.url,
          ),
        ),
        "use-sync-external-store/shim": fileURLToPath(
          new URL("./src/shims/use-sync-external-store.ts", import.meta.url),
        ),
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  optimizeDeps: hostOrigin
    ? {
        exclude: [
          "react",
          "react-dom",
          "input-otp",
          "lucide-react",
          "@base-ui/react",
          "@remixicon/react",
        ],
      }
    : {},
  server: {
    cors: true,
    ...(process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_API &&
    process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_TOKEN
      ? {
          proxy: {
            "/api/v1/modules/temporary-transfer": {
              target: process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_API,
              changeOrigin: true,
              rewrite: (path) =>
                path.replace(/^\/api\/v1\/modules\/temporary-transfer/, ""),
              headers: {
                "x-toolnest-internal-token":
                  process.env.TOOLNEST_TEMPORARY_TRANSFER_DEV_TOKEN,
                "x-toolnest-user-id": "1",
                "x-toolnest-user-is-admin": "true",
              },
            },
          },
        }
      : {}),
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
