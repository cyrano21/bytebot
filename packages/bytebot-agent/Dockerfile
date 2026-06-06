# Base image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Local TikTok market research uses the existing Playwright scraper from
# packages/bytebot-agent/python/market_research.py.
RUN apk add --no-cache \
    ca-certificates \
    chromium \
    freetype \
    harfbuzz \
    nss \
    py3-pip \
    python3 \
    ttf-freefont \
  && python3 -m venv /opt/bytebot-python \
  && /opt/bytebot-python/bin/pip install --no-cache-dir \
    playwright \
    playwright-stealth

ENV PATH="/opt/bytebot-python/bin:${PATH}"
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

# Copy dependency manifests first so source-only changes keep npm cached.
COPY packages/shared ./shared
COPY packages/bytebot-agent/package*.json ./bytebot-agent/

WORKDIR /app/bytebot-agent

# Install dependencies
RUN npm ci
RUN npm install prisma@6.6.0 --no-save

# Copy app source after dependencies are installed.
COPY packages/bytebot-agent/ ./

# Generate Prisma client before build
RUN npx prisma generate

RUN npm run build

# Run the application
CMD ["npm", "run", "start:prod"] 
