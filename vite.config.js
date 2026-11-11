import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// dev.html is the source page (used by `npm run dev`).
// `npm run build` bundles everything into one self-contained file and writes it
// to index.html in the project root, so index.html can be opened or hosted as-is.
export default defineConfig({
  base: './',
  publicDir: false, // models/ and audio/ live in the project root instead
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 5000,
    rollupOptions: { input: 'dev.html' },
  },
});
