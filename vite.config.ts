import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Base path.
 *
 * GitHub Pages serves a project site from /<repo>/, so the built asset URLs have to be
 * prefixed. Set BASE_PATH at build time (the deploy workflow does). Left as '/' for
 * local development and for a user site or custom domain.
 */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  base,

  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'maskable-icon.svg'],

      manifest: {
        name: 'היומן שלי — עוזר קולי',
        short_name: 'היומן שלי',
        description: 'עוזר יומן קולי בעברית',
        lang: 'he',
        dir: 'rtl',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f7f9',
        theme_color: '#3b5bdb',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          {
            src: 'maskable-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Precache the app shell only. Fonts are self-hosted so the shell is complete
        // offline, which is what makes the app open instantly from the home screen.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],

        // NEVER cache Google. Two reasons, both hard requirements:
        //   1. Calendar data is private and changes constantly — a cached agenda that
        //      says a slot is free could cause a double booking.
        //   2. The identity endpoints must always be live.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],
      },

      devOptions: {
        // A service worker in development caches stale modules and turns every edit
        // into a debugging session. Off.
        enabled: false,
      },
    }),
  ],

  server: {
    // Expose on the LAN so the app can be opened from the Android phone during
    // development. Note: the Web Speech API needs a secure context, so voice input
    // only works over HTTPS or on localhost — not over a plain http:// LAN IP.
    host: true,
    port: 5173,
  },

  test: {
    // The parser and conflict logic are pure, so they need no DOM. Component tests
    // opt in per file with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
