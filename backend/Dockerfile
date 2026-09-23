FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --registry=$NPM_REGISTRY
COPY backend backend
RUN npm run build -w backend
RUN npm prune --omit=dev --registry=$NPM_REGISTRY

FROM node:22-bookworm-slim
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/migrations ./backend/migrations
USER node
EXPOSE 3000
CMD ["node", "backend/dist/server.js"]
