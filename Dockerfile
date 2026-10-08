# syntax=docker/dockerfile:1
# Game Store — multi-stage: build (มี devDependencies + esbuild) → runtime (เฉพาะ production deps, รันด้วย user ที่ไม่ใช่ root)
# ⚠️ ไฟล์นี้ยังไม่เคยถูก build จริงบนเครื่องผู้พัฒนา (ไม่มี Docker daemon) — ดู docs/CHECKLIST.md

ARG NODE_VERSION=24

# ---------- 1) build: ติดตั้งทุก dependency แล้ว bundle/minify หน้าเว็บลง dist/ ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts ./scripts
COPY public ./public
COPY admin ./admin
COPY server ./server
RUN npm run build

# ---------- 2) deps: เฉพาะ production dependencies ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- 3) runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/store.db BACKUP_DIR=/app/data/backups
# ฟอนต์ไทย + fontconfig: ใช้วาดรูป OG (PNG) ของหน้าเกมด้วย sharp/librsvg (ใบเสร็จ PDF ใช้ฟอนต์ที่แนบในโปรเจกต์อยู่แล้ว)
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-thai-tlwg tini \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
WORKDIR /app
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
# โฟลเดอร์ข้อมูล (ฐานข้อมูล + รูปอัปโหลด + สำรองข้อมูล) — mount เป็น volume
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini ส่งสัญญาณ SIGTERM ให้ node ถูกต้อง → ปิดระบบอย่างเรียบร้อย (graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
