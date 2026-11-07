FROM node:22-alpine AS base
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY indexer/package.json indexer/package.json
RUN pnpm install --frozen-lockfile=false

COPY packages/sdk packages/sdk
COPY indexer indexer
RUN pnpm --filter @veritag/sdk build && pnpm --filter @veritag/indexer build

CMD ["pnpm", "--filter", "@veritag/indexer", "start"]
