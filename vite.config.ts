import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    clearScreen: false,
    server: {
      port: Number(process.env.TAURI_DEV_PORT || process.env.PORT || 1420),
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${Number(process.env.API_PORT || 3000)}`,
          changeOrigin: true,
        },
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
