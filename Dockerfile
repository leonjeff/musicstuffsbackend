FROM node:20-bookworm-slim AS base

# Instala binarios multimedia requeridos en runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    wget \
    ca-certificates \
    libboost-filesystem1.74.0 \
    libboost-program-options1.74.0 \
    libid3tag0 \
    libmad0 \
    libsndfile1 \
    libgd3 \
    && wget "https://github.com/bbc/audiowaveform/releases/download/1.10.1/audiowaveform_1.10.1-1-12_amd64.deb" -O /tmp/aw.deb \
    && dpkg -i /tmp/aw.deb \
    && rm /tmp/aw.deb \
    && apt-get purge -y --auto-remove wget \
    && rm -rf /var/lib/apt/lists/*

RUN ffprobe -version && audiowaveform --version

FROM base AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./

EXPOSE 3001
CMD ["node", "dist/main"]
