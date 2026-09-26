import axios from 'axios';

// VITE_API_URL=same-origin: the API is reached through whatever server
// serves the site (the `vite preview` proxy in vite.config.js), so the
// same build works under any hostname and port - used by the Tailscale
// Funnel demo setup in deploy/tunnel/ (candidate site on 443, staff on 8443).
const configuredApiUrl = import.meta.env.VITE_API_URL;
export const API_URL = configuredApiUrl === 'same-origin'
  ? window.location.origin
  : (configuredApiUrl || 'http://localhost:4000');

export const OFFLINE_MESSAGE = 'Server offline. We can\'t reach the server right now - please check your connection and try again shortly.';
export const TIMEOUT_MESSAGE = 'The server is taking too long to respond. Please try again.';
export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a moment.';

const client = axios.create({ baseURL: API_URL });

client.interceptors.request.use((config) => {
  const candidateToken = localStorage.getItem('candidateToken');
  const staffToken = localStorage.getItem('staffToken');
  const token = config.asStaff ? staffToken : candidateToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Every view reads `err.response?.data?.error` for what to show the user.
// Normalizing here means none of them ever surfaces a raw axios message
// ("Network Error", "Request failed with status code 500") or anything a
// server-side failure might have carried (database host, query text, stack
// details), and a request that never got a response at all - the server or
// network is down - reads as "Server offline" instead of each screen's
// generic fallback text. 4xx responses are left untouched: those are
// deliberate, user-facing validation/business messages.
function overrideError(error, status, message) {
  error.response = { ...(error.response || {}), status, data: { error: message } };
  return Promise.reject(error);
}

client.interceptors.response.use(
  (response) => response,
  (error) => {
    // A request cancelled on purpose (e.g. an aborted effect) isn't a failure to report.
    if (axios.isCancel(error)) return Promise.reject(error);

    if (!error.response) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return overrideError(error, 504, TIMEOUT_MESSAGE);
      }
      return overrideError(error, 503, OFFLINE_MESSAGE);
    }

    const { status } = error.response;
    if (status === 502 || status === 503 || status === 504) {
      return overrideError(error, status, OFFLINE_MESSAGE);
    }
    if (status >= 500) {
      return overrideError(error, status, SERVER_ERROR_MESSAGE);
    }
    return Promise.reject(error);
  }
);

export default client;
