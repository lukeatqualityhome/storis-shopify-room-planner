import { defineConfig } from "vite";

// Library build: single IIFE bundle + single CSS file with predictable names,
// so they upload cleanly to Shopify theme assets (referenced from Liquid via | asset_url).
export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      name: "QHFRoomPlanner",
      formats: ["iife"],
      fileName: () => "room-planner.js",
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith(".css")) return "room-planner.css";
          return "room-planner-[name][extname]";
        },
      },
    },
  },
  server: {
    port: 5173,
    open: "/",
  },
});
