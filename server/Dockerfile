FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm install
COPY server ./server
WORKDIR /app/server
CMD ["npm", "run", "start:api"]
