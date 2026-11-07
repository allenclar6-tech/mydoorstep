FROM node:22-alpine

# openssl: Prisma's query engine needs it on Alpine. su-exec: drop from root to "node" after fixing upload permissions.
RUN apk add --no-cache openssl su-exec

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# devDependencies (wrangler) are skipped; the Prisma CLI is a runtime dependency (migrations run at start).
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma
RUN npx prisma generate

COPY server ./server
RUN sed -i 's/\r$//' server/docker-entrypoint.sh && chmod 755 server/docker-entrypoint.sh && chown -R node:node /app

# Private uploads live on a mounted volume, never inside the container (override with the env var).
ENV PRIVATE_UPLOAD_DIR=/data/private-uploads
VOLUME ["/data/private-uploads"]

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/app/server/docker-entrypoint.sh"]
CMD ["sh", "-c", "node server/migrate.js && node server/index.js"]
