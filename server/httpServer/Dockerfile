# build from the repository root: docker build -f server/httpServer/Dockerfile .
FROM node:20

WORKDIR /usr/src/app

COPY server/httpServer/package*.json ./
RUN npm install --omit=dev --silent

COPY server/config.js ./server/config.js
COPY server/httpServer ./server/httpServer
COPY client ./client

EXPOSE 3000

CMD ["node", "server/httpServer/app.js"]
