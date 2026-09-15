FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/index.js"]
