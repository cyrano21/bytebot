# Base image (Debian slim: Playwright Python wheels require glibc, not musl/Alpine)
FROM node:20-bookworm-slim

# Create app directory
WORKDIR /app

# Local TikTok market research uses the existing Playwright scraper from
# packages/bytebot-agent/python/market_research.py.
# Debian ships chromium at /usr/bin/chromium and provides glibc Playwright wheels.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-freefont-ttf \
    libfreetype6 \
    libharfbuzz0b \
    libnss3 \
    python3 \
    python3-venv \
    python3-pip \
  && python3 -m venv /opt/bytebot-python \
  && /opt/bytebot-python/bin/pip install --no-cache-dir \
    playwright \
    playwright-stealth \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/bytebot-python/bin:${PATH}"
ENV CHROMIUM_PATH=/usr/bin/chromium

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
