# build from the repository root: docker build -f server/roomManager/Dockerfile .
FROM node:20

WORKDIR /usr/src/app

COPY server/roomManager/package*.json ./
RUN npm install --omit=dev --silent

COPY server/roomManager ./server/roomManager

EXPOSE 3002

CMD ["node", "server/roomManager/app.js"]
