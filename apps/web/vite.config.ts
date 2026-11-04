import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// VITE_BASE = ruta donde se publica el sitio (ej: /dashboard-qa/ en GitHub Pages). Por defecto "/".
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd() + "/../..", "VITE_");
  return {
    base: env.VITE_BASE || "/",
    envDir: "../..",
    plugins: [react()],
    server: { fs: { allow: ["../.."] } },
    build: { sourcemap: true, chunkSizeWarningLimit: 900 },
  };
});
