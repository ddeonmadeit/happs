import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";

// GitHub Pages serves the app from /<repo>/, so the build takes its base path
// from BASE_PATH (set in the deploy workflow). Locally it's just "/".
const base = process.env.BASE_PATH ?? "/";

const BACKGROUND = "#13110f";

/**
 * GitHub Pages has no SPA rewrites. Serving index.html as 404.html lets deep
 * links (/happs/map, auth email links…) boot the app, which then routes.
 */
function spaFallback(): Plugin {
  return {
    name: "spa-404-fallback",
    apply: "build",
    closeBundle() {
      const out = path.resolve(__dirname, "dist");
      const index = path.join(out, "index.html");
      if (fs.existsSync(index)) {
        fs.copyFileSync(index, path.join(out, "404.html"));
        fs.writeFileSync(path.join(out, ".nojekyll"), "");
      }
    },
  };
}

/** Open the connection to the backend while the app is still loading. */
function preconnectBackend(): Plugin {
  let url = "";
  return {
    name: "preconnect-backend",
    configResolved(config) {
      url = config.env.VITE_SUPABASE_URL ?? "";
    },
    transformIndexHtml(html) {
      if (!/^https:\/\//.test(url)) return html;
      const origin = new URL(url).origin;
      return html.replace("</head>", `    <link rel="preconnect" href="${origin}" crossorigin />\n  </head>`);
    },
  };
}

export default defineConfig({
  base,
  server: { host: true, port: 8080 },
  plugins: [
    react(),
    VitePWA({
      // Custom service worker so we can handle push notifications.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,ttf,woff2,webp}"],
        // Only the Latin cut of Inter is precached; other scripts load on demand.
        globIgnores: ["splash/**", "404.html", "**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese,latin-ext}-*"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: base,
        name: "The Happs",
        short_name: "Happs",
        description: "See what's happening around you, right now.",
        start_url: base,
        scope: base,
        display: "standalone",
        display_override: ["standalone"],
        orientation: "portrait",
        background_color: BACKGROUND,
        theme_color: BACKGROUND,
        lang: "en",
        categories: ["social", "lifestyle", "navigation"],
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      devOptions: { enabled: false, type: "module" },
    }),
    spaFallback(),
    preconnectBackend(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mapbox: ["mapbox-gl"],
          supabase: ["@supabase/supabase-js"],
          react: ["react", "react-dom", "react-router-dom"],
          motion: ["motion/react"],
        },
      },
    },
    chunkSizeWarningLimit: 2000,
  },
});
