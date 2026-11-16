# PulseWatch

PulseWatch is a website monitoring and incident management SaaS. This repository contains the project foundation: a React client, Express API, MongoDB replica set, Redis, and independently startable worker and scheduler processes. Authentication, monitor CRUD, and scheduling/job logic are intentionally not part of this foundation stage.

## Technology

- Client: React, TypeScript, Vite, Tailwind CSS, shadcn/ui configuration, TanStack React Query
- Server: Node.js ES modules, Express, MongoDB, Mongoose, Zod
- Infrastructure: Redis, Docker Compose
- Tests: Jest and Supertest

## Project layout

```text
client/    React application and UI configuration
server/    Express API and separate API, worker, scheduler entry points
docker/    MongoDB replica set initialization
```

## Requirements

- Node.js 22 or newer and npm
- Docker Desktop with Docker Compose

## Start with Docker Compose

1. Copy `.env.example` to `.env`. The included values are for local development only.
2. Start the stack with `docker compose up --build`.
3. Open the client at http://localhost:5173.
4. Check API liveness at http://localhost:4000/api/v1/health and readiness at http://localhost:4000/api/v1/ready.

MongoDB starts as replica set `rs0`, which supports transactions. Redis persistence is enabled with AOF. Docker Compose waits for MongoDB/Redis health before starting the API, worker, and scheduler.

## Local development

Copy `.env.example` to `.env`, start only the local infrastructure, then install and run the local applications and processes:

```sh
docker compose up -d mongodb redis
npm install
npm run dev
```

The Vite server runs on port 5173 and proxies `/api` to the API on port 4000. MongoDB and Redis ports are bound to `127.0.0.1`; the local Node processes connect through `localhost`, while Docker services use the internal service names `mongodb` and `redis`. To start processes separately, use `npm run dev:client`, `npm run dev:api`, `npm run dev:worker`, or `npm run dev:scheduler`.

## Useful commands

```sh
npm run build
npm test
npm run lint
npm run start:api
npm run start:worker
npm run start:scheduler
```

The worker and scheduler currently validate their MongoDB/Redis connections, log startup, and shut down gracefully; their business algorithms are intentionally not enabled yet.

## Environment

See `.env.example` for the required variables. The server validates configuration at startup and exits with field-level errors when required values are missing or invalid. Never commit a real `.env` or production secret.
