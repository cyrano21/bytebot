# Base image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy models.toml from workspace root
COPY models.toml ./models.toml

# Copy app source (packages subdirectory)
COPY packages/shared ./shared
COPY packages/bytebot-agent/ ./bytebot-agent/

WORKDIR /app/bytebot-agent

# Install dependencies
RUN npm install

# Generate Prisma client before build
RUN npx prisma generate

RUN npm run build

# Run the application
CMD ["npm", "run", "start:prod"] 


