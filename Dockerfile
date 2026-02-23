# Build and run bulk-validation-pipeline (Node 20)
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app
COPY src ./src
COPY ecosystem.config.cjs ./

# Default: run API (override in compose for workers)
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
