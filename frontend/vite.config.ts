import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Charting is admin-only and heavy. Splitting it out means the admin
          // shell paints before the chart bundle finishes downloading, and the
          // chunk is cached separately from fast-moving page code.
          charts: ["recharts"],
        },
      },
    },
  },
});
