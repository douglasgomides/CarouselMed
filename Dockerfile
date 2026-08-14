# CarouselMed — container para deploy (Render/Railway/Fly.io)
FROM node:20-slim

# Chromium + libs necessárias para o Puppeteer rodar no servidor
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxkbcommon0 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Puppeteer usa o Chromium do sistema (não baixa o próprio)
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Instala dependências
COPY package*.json ./
RUN npm install --omit=dev

# Copia o resto do projeto (inclui fonts/ empacotadas)
COPY . .

# Pastas de dados (montadas em disco persistente no deploy)
RUN mkdir -p uploads output designs

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.js"]
