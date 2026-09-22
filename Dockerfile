FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY server ./server
COPY private-uploads ./private-uploads

EXPOSE 4000
CMD ["node", "server/index.js"]
