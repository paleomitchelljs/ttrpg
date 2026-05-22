import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import yaml from '@modyfi/vite-plugin-yaml';

// Set VITE_BASE at build time when deploying to a project-page subpath,
// e.g. VITE_BASE=/shadowdark/ npm run build
export default defineConfig({
  plugins: [react(), yaml()],
  base: process.env.VITE_BASE ?? '/',
});
