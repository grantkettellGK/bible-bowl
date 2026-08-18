FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
