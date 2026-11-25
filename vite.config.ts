import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    proxy: {
      // `npm run dev:worker`（wrangler dev, 8787）へ API を中継
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
