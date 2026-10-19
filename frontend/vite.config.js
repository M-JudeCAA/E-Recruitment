import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// `vite preview` settings for the office-network test deployment
// (deploy/lan/), read from frontend/.env without the VITE_ prefix so they
// never reach the browser bundle. All optional; unset, preview behaves as
// before (plain http, no proxy).
//   PREVIEW_API_TARGET      forward /api and /ws here, for builds made with
//                           VITE_API_URL=same-origin (e.g. http://127.0.0.1:4100)
//   PREVIEW_TLS_PFX         serve HTTPS with this .pfx certificate ...
//   PREVIEW_TLS_PASSPHRASE  ... and its passphrase
//   PREVIEW_ALLOWED_HOSTS   comma-separated host names testers use (IP addresses are always allowed)

// Where the built app reaches the API, for the Content-Security-Policy:
// nothing extra for a same-origin build, else that origin (http and ws).
function apiSources(apiUrl) {
  if (apiUrl === 'same-origin') return { http: [], ws: [] };
  const origin = new URL(apiUrl || 'http://localhost:4000').origin;
  return { http: [origin], ws: [origin.replace(/^http/, 'ws')] };
}

// Browser security headers for every page the preview server sends (the
// served build - the dev server is left alone, its hot reload needs inline
// scripts). Session tokens live in localStorage, so the CSP is what keeps an
// injected script from running at all. Microsoft sign-in (MSAL) and the
// directory search (Graph) are the only outside services the app talks to.
export function securityHeaders({ apiUrl, https }) {
  const api = apiSources(apiUrl);
  const microsoft = ['https://login.microsoftonline.com'];
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // React's style={} props are inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api.http.join(' ')}`,
    "font-src 'self' data:",
    `connect-src 'self' ${[...api.http, ...api.ws, ...microsoft, 'https://graph.microsoft.com'].join(' ')}`,
    // The document viewer frames PDFs from the API; MSAL renews silently in a hidden frame.
    `frame-src 'self' blob: ${[...api.http, ...microsoft].join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].map((d) => d.replace(/\s+$/, '')).join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    ...(https ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}

// Set before Vite's own middleware, so the index page, assets and the SPA
// fallback all carry them (a proxied /api answer keeps the API's own).
function securityHeadersPlugin(headers) {
  return {
    name: 'security-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['PREVIEW_', 'VITE_']);
  const target = env.PREVIEW_API_TARGET;
  const preview = {};
  if (target) {
    // xfwd passes the visitor's address on, for the API's sign-in rate limits
    // (the API trusts it because the proxy is on loopback, TRUST_PROXY).
    preview.proxy = {
      '/api': { target, xfwd: true },
      '/ws': { target, ws: true, xfwd: true },
    };
  }
  if (env.PREVIEW_TLS_PFX) {
    preview.https = { pfx: fs.readFileSync(env.PREVIEW_TLS_PFX), passphrase: env.PREVIEW_TLS_PASSPHRASE };
  }
  if (env.PREVIEW_ALLOWED_HOSTS) {
    preview.allowedHosts = env.PREVIEW_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean);
  }
  return {
    plugins: [react(), securityHeadersPlugin(securityHeaders({ apiUrl: env.VITE_API_URL, https: Boolean(preview.https) }))],
    server: { port: 5173 },
    preview,
  };
});
