import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2_500,
  },
  server: {
    port: 4173,
  },
});
