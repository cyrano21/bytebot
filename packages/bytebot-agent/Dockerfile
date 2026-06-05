# Base image
FROM node:20-alpine

# Create app directory
WORKDIR /app

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
