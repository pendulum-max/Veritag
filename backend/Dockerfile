FROM node:22-alpine AS base
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY backend/package.json backend/package.json
RUN pnpm install --frozen-lockfile=false

COPY packages/sdk packages/sdk
COPY backend backend
RUN pnpm --filter @veritag/sdk build && pnpm --filter @veritag/backend build

EXPOSE 4000
CMD ["pnpm", "--filter", "@veritag/backend", "start"]
