import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/cayed/',
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      globals: {
        Buffer: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@client': path.resolve(__dirname, './client'),
      // solana-kite dynamically imports these Node builtins but never
      // calls them in the browser – point to a no-op shim.
      'fs/promises': path.resolve(__dirname, './src/shims/empty.ts'),
      fs: path.resolve(__dirname, './src/shims/empty.ts'),
    },
  },
});
