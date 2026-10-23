import { defineConfig } from 'vite';

export default defineConfig({
  base: '/heichengji/',
  server: {
    host: '0.0.0.0',
    port: 4317,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4317,
    strictPort: true,
    allowedHosts: true,
  },
});
