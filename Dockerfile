FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY facilitator/package.json facilitator/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY shared/ shared/
COPY server/ server/
COPY facilitator/ facilitator/
COPY frontend/ frontend/

# --- Frontend build ---
FROM base AS frontend-build
ARG VITE_SERVER_URL=http://localhost:4401
ARG VITE_WALLETCONNECT_PROJECT_ID=x402-poc-demo
ENV VITE_SERVER_URL=$VITE_SERVER_URL
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
RUN pnpm --filter @x402/frontend build

# --- Frontend serve ---
FROM nginx:alpine AS frontend
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80

# --- Server ---
FROM base AS server
EXPOSE 4401
CMD ["pnpm", "--filter", "@x402/server", "start"]

# --- Facilitator ---
FROM base AS facilitator
EXPOSE 4402
CMD ["pnpm", "--filter", "@x402/facilitator", "start"]
