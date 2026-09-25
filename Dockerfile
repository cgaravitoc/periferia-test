# Imagen oficial de Bun (sigue la ultima 1.x).
FROM oven/bun:1

WORKDIR /app

# Instala dependencias primero para aprovechar la cache de capas.
COPY package.json bun.lock* ./
RUN bun install

# Copia el resto del proyecto (incluye fixtures, agent/, src/, web/).
COPY . .

# Render/host inyecta PORT; el servidor lo lee de process.env.PORT.
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
