import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deployed to the custom domain (sendsignal.cc) as a root Pages site, so assets
// load from '/'. For a repo/user subpath (github.com/<user>/sscc/) set
// VITE_GH_BASE to '/sscc/' instead.
const base = process.env.VITE_GH_BASE || '/';

export default defineConfig({
  base,
  plugins: [react()],
});
