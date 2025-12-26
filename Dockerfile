FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Build (optional, we're using tsx for now)
# RUN npm run build

# Copy config (will be overridden by volume mount)
COPY config.yaml ./

EXPOSE 8223

CMD ["npx", "tsx", "src/index.ts"]

