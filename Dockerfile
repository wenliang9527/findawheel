# ---- 构建阶段:编译 TypeScript ----
FROM node:22-alpine AS builder
WORKDIR /app
# 先复制依赖清单,利用 Docker 层缓存(仅依赖变化时才重装)
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- 运行阶段:仅生产依赖 + 编译产物 ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# 只装生产依赖(@modelcontextprotocol/sdk + zod),不含 typescript/vitest
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# 以非 root 用户运行(安全)
USER node
# MCP 服务通过 stdio 通信,无需暴露端口。
# 客户端配置:docker run -i --rm findawheel (需 -i 保持 stdin 交互)
ENTRYPOINT ["node", "dist/index.js"]
