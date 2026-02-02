# Poster Memento - Multi-stage Docker build
# Builds TypeScript and serves API + static UI

# ============================================
# Stage 1: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (sharp, etc.)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY config/ ./config/
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy UI static files
COPY instances/posters/ui ./ui

# Copy instance config
COPY instances/posters/config ./config

# Create directory for source images (will be mounted)
RUN mkdir -p /app/source-images

# Set environment variables
ENV NODE_ENV=production
ENV API_PORT=3000
ENV API_HOST=0.0.0.0
ENV CONFIG_PATH=/app/config/instance-config.json
ENV UI_STATIC_PATH=/app/ui

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the API server
CMD ["node", "dist/servers/http-server.js"]
