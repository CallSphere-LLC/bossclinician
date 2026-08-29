import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Two builds come out of this config.
 *
 * `vite build` produces the browser bundle in dist/client — what the frontend
 * nginx container serves. `vite build --ssr` produces dist/server/entry-server.cjs,
 * which the API process requires to render marketing pages to HTML.
 */
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  ssr: {
    // Bundle every dependency rather than leaving them to be required at
    // runtime. The API container has no React, no motion and no react-markdown
    // installed, and several of them ship ESM only, which a CommonJS process
    // cannot require at all. One self-contained file sidesteps both problems.
    noExternal: true,
  },
  build: {
    outDir: isSsrBuild ? "dist/server" : "dist/client",
    // Only the browser build serves files. Copying 172 images a second time
    // would put them in the API image for nothing.
    copyPublicDir: !isSsrBuild,
    // The SSR bundle is loaded by `require` from a CommonJS API process.
    //
    // The .cjs extension is load-bearing, not cosmetic: this package.json says
    // "type": "module", so Node reads any .js file beneath it as ESM and
    // `require` of it throws "exports is not defined". The renderer catches
    // that and quietly serves a client-only shell, so the symptom is not an
    // error — it is SSR silently disappearing, which on this site means
    // crawlers get an empty page. It happens to work in the API container only
    // because the bundle is copied next to the backend's own package.json,
    // which has no "type". Naming the file .cjs makes it correct everywhere,
    // including `npm run dev` and any SSR_DIST_DIR pointed at this tree.
    // Emitted chunks are already .cjs; this only aligns the entry with them.
    ...(isSsrBuild
      ? { rollupOptions: { output: { format: "cjs" as const, entryFileNames: "[name].cjs" } } }
      : {
          rollupOptions: {
            output: {
              manualChunks: {
                // Charting is admin-only and heavy. Splitting it out means the
                // admin shell paints before the chart bundle finishes
                // downloading, and the chunk is cached separately from
                // fast-moving page code.
                charts: ["recharts"],
              },
            },
          },
        }),
  },
}));
