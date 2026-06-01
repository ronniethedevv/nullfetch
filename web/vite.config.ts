import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// The Zama relayer SDK ships native WASM (tfhe + kms) and uses top-level
// await inside its web entrypoint. Without these two plugins Vite cannot
// bundle it for the browser. `optimizeDeps.exclude` keeps esbuild from
// trying to pre-bundle the WASM-bearing module.
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ['@zama-fhe/relayer-sdk', '@zama-fhe/relayer-sdk/web'],
  },
  server: {
    port: 5173,
    // Allow reading deployments.json from the parent directory so the
    // web app can auto-fill the deployed contract address. The build
    // step doesn't care; this only relaxes the dev server's fs guard.
    fs: { allow: ['..'] },
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
});
