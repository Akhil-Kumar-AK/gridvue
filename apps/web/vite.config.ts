import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT ?? 5273), strictPort: true, proxy: { '/api': process.env.API_URL ?? 'http://localhost:8787' } },
  build: { chunkSizeWarningLimit: 900 },
});
