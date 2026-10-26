import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const shim = (name: string) => fileURLToPath(new URL(`./src/leinwand/shims/${name}`, import.meta.url));

// Die Leinwand stammt aus ArtCraft und importiert dessen interne Pakete;
// Captr ersetzt sie durch kleine Nachbauten unter src/leinwand/shims.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@storyteller/common": shim("common.ts"),
      "@storyteller/icons": shim("icons.tsx"),
      "@storyteller/keybinds": shim("keybinds.ts"),
      "@storyteller/ui-tooltip": shim("tooltip.tsx"),
      "@storyteller/ui-action-reminder-modal": shim("action-reminder.tsx"),
    },
  },
  build: {
    outDir: "../backend/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
