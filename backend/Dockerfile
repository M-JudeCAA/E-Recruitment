FROM node:20-bookworm-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Full install, not --omit=dev: the prisma CLI (a devDependency) is needed at
# runtime by `npm run db:prepare` (scripts/prepareDatabase.js).
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts

EXPOSE 4000
CMD ["node", "src/server.js"]
