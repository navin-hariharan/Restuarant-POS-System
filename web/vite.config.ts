import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The Rust server serves this build from web/dist at the site root, with
// every path outside /api/v1 and /storage falling back to index.html.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        // Libraries in their own long-cached chunks; charts load only with the pages that draw them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](recharts|recharts-scale|react-smooth|d3-[a-z-]+|victory-vendor|internmap|decimal\.js-light|lodash)[\\/]/.test(id)) return 'charts';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run|cookie|set-cookie-parser)[\\/]/.test(id)) return 'router';
          if (/[\\/]node_modules[\\/](@tanstack|axios|sonner|clsx)[\\/]/.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:9107',
      '/storage': 'http://127.0.0.1:9107',
    },
  },
  // Same content security policy as the server, so `npm run preview` shows any violation.
  preview: {
    port: 4173,
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
