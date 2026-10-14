FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY server ./server

EXPOSE 4000
CMD ["sh", "-c", "node server/migrate.js && node server/index.js"]
