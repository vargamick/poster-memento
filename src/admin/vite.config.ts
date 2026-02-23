import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: __dirname,
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../../public/admin'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
