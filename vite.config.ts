import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const clientPort = Number(process.env.VITE_PORT) || 5173;
const apiPort = Number(process.env.PORT) || 5177;

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: clientPort,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  },
  test: {
    exclude: [...configDefaults.exclude, "app/e2e/**"],
    pool: "threads",
    maxWorkers: 1
  }
});
