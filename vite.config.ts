import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /fly/ or any other subpath.
  base: './',
  // three.js alone is ~550 kB minified; that's expected for this project.
  build: { chunkSizeWarningLimit: 1000 },
});
