FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY src ./src

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache cairo pango jpeg giflib librsvg dumb-init \
    && addgroup -S signpro && adduser -S signpro -G signpro

COPY --from=builder --chown=signpro:signpro /app/node_modules ./node_modules
COPY --from=builder --chown=signpro:signpro /app/src ./src
COPY --chown=signpro:signpro package*.json ./

RUN mkdir -p /app/uploads/signed && chown -R signpro:signpro /app/uploads

USER signpro
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:4000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
