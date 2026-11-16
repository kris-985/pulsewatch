FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm install
COPY client ./client
WORKDIR /app/client
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
