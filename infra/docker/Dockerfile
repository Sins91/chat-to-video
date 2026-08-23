FROM node:26.7.0-bookworm-slim AS dependencies

ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN registry_url="${NPM_REGISTRY%/}" \
    && npm install --global corepack@0.34.7 --registry="${registry_url}" \
    && corepack enable pnpm \
    && COREPACK_NPM_REGISTRY="${registry_url}" corepack install --global pnpm@11.20.0

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

RUN node scripts/install-with-registry-fallback.cjs --frozen-lockfile

FROM dependencies AS database-migrate

ENV NODE_ENV=production

COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/contracts ./packages/contracts
COPY packages/database ./packages/database

USER node

CMD ["pnpm", "--filter", "@chat-to-video/database", "db:migrate"]

FROM dependencies AS api-build

COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
COPY packages/database ./packages/database
COPY packages/storage ./packages/storage

RUN pnpm --filter @chat-to-video/api... build

FROM node:26.7.0-bookworm-slim AS api-runtime

ENV NODE_ENV=production
ENV API_PORT=4101

WORKDIR /app

COPY --from=api-build --chown=node:node /app/node_modules ./node_modules
COPY --from=api-build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=api-build --chown=node:node /app/packages ./packages

USER node
EXPOSE 4101

CMD ["node", "apps/api/dist/main.js"]

FROM dependencies AS worker-build

COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/worker ./apps/worker
COPY packages/contracts ./packages/contracts
COPY packages/media ./packages/media
COPY packages/database ./packages/database
COPY packages/storage ./packages/storage

RUN pnpm --filter @chat-to-video/worker... build

FROM node:26.7.0-bookworm-slim AS worker-runtime

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY --from=worker-build --chown=node:node /app/node_modules ./node_modules
COPY --from=worker-build --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=worker-build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=worker-build --chown=node:node /app/packages ./packages

USER node
CMD ["node", "apps/worker/dist/main.js"]

FROM dependencies AS web-build

COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/web ./apps/web
COPY packages/contracts ./packages/contracts

RUN pnpm --filter @chat-to-video/web... build

FROM node:26.7.0-bookworm-slim AS web-runtime

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=4000
ENV WEB_PORT=4000

WORKDIR /app

COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 4000

CMD ["node", "apps/web/server.js"]
