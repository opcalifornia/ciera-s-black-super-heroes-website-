# Single-stage build: better-sqlite3 and sharp both ship prebuilt native
# binaries for common platforms, so a plain `npm ci` here just downloads
# them — no compiler toolchain needed.
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Local (non-persistent-disk) fallback locations; overridden by DB_PATH /
# UPLOAD_DIR in production (see render.yaml).
RUN mkdir -p data uploads

EXPOSE 3000
CMD ["node", "server.js"]
