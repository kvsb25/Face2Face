# build from the repository root: docker build -f server/wsServer/Dockerfile .
FROM node:20

WORKDIR /usr/src/app

COPY server/wsServer/package*.json ./
RUN npm install --omit=dev --silent

COPY server/config.js ./server/config.js
COPY server/wsServer ./server/wsServer

EXPOSE 3001

CMD ["node", "server/wsServer/app.js"]
