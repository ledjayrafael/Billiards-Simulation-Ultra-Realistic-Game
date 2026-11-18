import { defineConfig } from 'vite';

export default defineConfig({
  // host: true → bisa diakses perangkat lain di WiFi yang sama (http://<IP-LAN>:5173)
  server: { port: 5173, host: true, proxy: { '/api': 'http://localhost:3000' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
});
