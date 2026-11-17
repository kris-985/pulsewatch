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

MongoDB starts as replica set `rs0`, which supports transactions. A one-shot `mongo-rs-init` service waits for MongoDB connectivity, initializes `rs0` only when needed, and waits for a PRIMARY with logical sessions enabled. API, worker, and scheduler wait for both successful initialization and MongoDB's PRIMARY healthcheck. Redis persistence is enabled with AOF. Existing MongoDB volumes are retained; a volume configured with a different replica set name causes initialization to fail without modifying it.

## Local development

Copy `.env.example` to `.env`, start only the local infrastructure, then install and run the local applications and processes:

```sh
docker compose up -d mongodb redis mongo-rs-init
npm install
npm run dev
```

Before starting local processes, wait until `docker compose ps` reports `mongodb` as healthy and `mongo-rs-init` as exited successfully. The Vite server runs on port 5173 and proxies `/api` to the API on port 4000. MongoDB and Redis ports are bound to `127.0.0.1`; the local Node processes connect through `localhost`, while Docker services use the internal service names `mongodb` and `redis`. To start processes separately, use `npm run dev:client`, `npm run dev:api`, `npm run dev:worker`, or `npm run dev:scheduler`.

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

## Authentication and personal workspace

Registration creates a user, a personal free workspace, and the first refresh-token session in one MongoDB transaction. The available endpoints are:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me` (requires `Authorization: Bearer <access-token>`)
- `GET /api/v1/workspaces/current` (requires `Authorization: Bearer <access-token>`)

Passwords use bcrypt with cost 12 and are limited to bcrypt's 72-byte UTF-8 input boundary. Access JWTs expire after 15 minutes. Refresh JWTs rotate on refresh; reuse of an already rotated token revokes its token family. Refresh tokens are only returned as `HttpOnly`, `SameSite=Strict` cookies (also `Secure` in production). Refresh and logout require the CSRF cookie/header pair and an allowlisted Origin. Access tokens are held in client memory, and the client restores a session through the refresh endpoint. After logout, an already-issued access token remains valid until its 15-minute expiry; protected requests do not query session status.

Registration and refresh-session writes require MongoDB transactions, so MongoDB must be running as the configured `rs0` replica set. Unit and HTTP tests use repository/service doubles where the database is unavailable; they do not establish that live MongoDB transactions work. That still requires running the Docker Replica Set and transaction probe.

## Environment

See `.env.example` for the required variables. The server validates configuration at startup and exits with field-level errors when required values are missing or invalid. Never commit a real `.env` or production secret.
