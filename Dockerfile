# The game plus its save server, for hosting online (see docs/HOSTING.md).
# Needs a PostgreSQL database: set DATABASE_URL. Serves the game and /api on $PORT (default 8787).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
# Runtime only: pg and tsx (the server runs from TypeScript).
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/engine ./src/engine
COPY src/shared ./src/shared
COPY tsconfig.json tsconfig.server.json ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/index.ts"]
