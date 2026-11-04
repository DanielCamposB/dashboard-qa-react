# Imagen de la API (apps/api). Construir desde la raíz del repositorio:  docker build -t dashboard-qa-api .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/api ./apps/api
# solo las dependencias de la API y del paquete compartido (la web no se instala)
RUN npm ci --workspace @qa/api --workspace @qa/core --include-workspace-root
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "apps/api/src/server.ts"]
