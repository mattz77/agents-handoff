# Builder stage
FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
# Motor "claude-cli" do Daemon-TaskAgent — headless `claude -p` num clone temporário.
RUN npm install -g @anthropic-ai/claude-code@1.0.0

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY public/ ./public/

# Create a non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -m -s /bin/bash nodejs
RUN chown -R nodejs:nodejs /app
# /data/vectorstore é volume Docker separado (montado em runtime, fora de /app) — o chown acima
# não alcança. Named volume herda dono/permissão do conteúdo da imagem na primeira criação.
RUN mkdir -p /data/vectorstore && chown -R nodejs:nodejs /data/vectorstore

RUN git config --system --add safe.directory /repo

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]
