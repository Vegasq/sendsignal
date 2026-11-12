import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages deploys the app at a subpath equal to the repo name.
// For a root site (github.com/<user>/) set base to '/'.
const base = process.env.VITE_GH_BASE || '/sscc/';

export default defineConfig({
  base,
  plugins: [react()],
});
