FROM node:20-slim

WORKDIR /app

# install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# app source
COPY . ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
