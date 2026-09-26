# Builds the SPA twice - candidate site and staff site (VITE_STAFF_SITE=true,
# see frontend/src/staffPort.js) - and serves both from Caddy, which also
# terminates HTTPS and proxies the API. Build context: frontend/.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG API_URL
RUN VITE_API_URL="$API_URL" npm run build && mv dist /out-web
RUN VITE_API_URL="$API_URL" VITE_STAFF_SITE=true npm run build && mv dist /out-staff

FROM caddy:2-alpine
COPY --from=build /out-web /srv/web
COPY --from=build /out-staff /srv/staff
