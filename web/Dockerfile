FROM node:22-alpine AS base
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile=false

COPY packages/sdk packages/sdk
COPY web web
RUN pnpm --filter @veritag/sdk build && pnpm --filter @veritag/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@veritag/web", "start"]
