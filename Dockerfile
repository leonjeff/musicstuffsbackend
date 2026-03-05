FROM node:20-bookworm-slim

# Instalar ffmpeg y audiowaveform
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    wget \
    && wget -q https://github.com/bbc/audiowaveform/releases/download/1.10.1/audiowaveform_1.10.1-1-12_amd64.deb \
    && apt-get install -y --no-install-recommends ./audiowaveform_1.10.1-1-12_amd64.deb \
    && rm audiowaveform_1.10.1-1-12_amd64.deb \
    && apt-get remove -y wget \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/main"]
