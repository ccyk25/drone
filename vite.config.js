import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import basicSsl from '@vitejs/plugin-basic-ssl';

const root = fileURLToPath(new URL('.', import.meta.url));

// During local dev, phones can't open "localhost", so we expose the laptop's LAN address
// for the QR codes on the debug page. In production builds this is an empty string.
function lanOrigin(https) {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  // Prefer normal Wi-Fi/LAN ranges over VPN ranges (e.g. 100.64.0.0/10).
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const ip = ips.find(isPrivate) ?? ips[0];
  return ip ? `${https ? 'https' : 'http'}://${ip}:5173` : '';
}

export default defineConfig(({ command, mode }) => {
  const https = mode === 'https';
  return {
    plugins: https ? [basicSsl()] : [],
    server: { host: true, port: 5173 },
    define: {
      __DEV_LAN_ORIGIN__: JSON.stringify(command === 'serve' ? lanOrigin(https) : '')
    },
    build: {
      rollupOptions: {
        input: {
          main: `${root}index.html`,
          ear: `${root}ear.html`,
          debug: `${root}debug.html`,
          lab: `${root}lab.html`
        }
      }
    },
    test: { environment: 'node' }
  };
});
