# Diskurt API sunucusu. Derleme bağlamı depo köküdür:
#   docker build -f apps/server/Dockerfile .
FROM node:24-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN pnpm install --frozen-lockfile --filter "@diskurt/server..."
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @diskurt/server build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=127.0.0.1 \
    PORT=3000
# Paket tek dosyadır; yalnızca yerel (native) şifreleme modülü ayrıca kurulur.
RUN npm install --no-save --no-package-lock @node-rs/argon2@2.2.1 && npm cache clean --force
COPY --from=build /repo/apps/server/dist ./dist
VOLUME /data
CMD ["node", "--enable-source-maps", "dist/index.js"]
