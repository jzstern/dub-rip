FROM node:20-alpine

WORKDIR /app

COPY services/yt-token/package*.json ./
RUN npm install --production

COPY services/yt-token/index.js ./

ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "index.js"]
