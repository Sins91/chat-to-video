FROM node:26.7.0-bookworm-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts ./scripts
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/media/package.json ./packages/media/package.json
COPY packages/storage/package.json ./packages/storage/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS api-build

COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api ./apps/api

RUN pnpm --filter @chat-to-video/api build

FROM node:26.7.0-bookworm-slim AS api-runtime

ENV NODE_ENV=production
ENV API_PORT=3001

WORKDIR /app

COPY --from=api-build --chown=node:node /app/node_modules ./node_modules
COPY --from=api-build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-build --chown=node:node /app/apps/api/dist ./apps/api/dist

USER node
EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]

FROM dependencies AS web-build

COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/web ./apps/web

RUN pnpm --filter @chat-to-video/web build

FROM node:26.7.0-bookworm-slim AS web-runtime

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
