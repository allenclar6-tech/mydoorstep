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
CMD ["sh", "-c", "npx prisma db push && if [ -n \"$ADMIN_EMAIL\" ] && [ -n \"$ADMIN_PASSWORD\" ]; then node server/createAdmin.js || echo 'Admin bootstrap failed; API will continue'; fi; exec node server/index.js"]
