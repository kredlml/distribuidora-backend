import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 8081 },
  // Render sirve con `vite preview` bajo un dominio *.onrender.com
  preview: { host: true, allowedHosts: true },
});
