FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate && npm prune --omit=dev

COPY server ./server
COPY private-uploads ./private-uploads

EXPOSE 4000
CMD ["node", "server/index.js"]
