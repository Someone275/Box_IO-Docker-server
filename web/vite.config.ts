import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3941,
    proxy: {
      "/api": "http://127.0.0.1:3847",
      "/hw": "http://127.0.0.1:3847",
      "/ws": { target: "ws://127.0.0.1:3847", ws: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 3941,
  },
});
