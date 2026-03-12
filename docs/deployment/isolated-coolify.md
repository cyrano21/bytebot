# Isolated Coolify Deployment

This deployment splits Bytebot into two independent resources:

- `bytebot-core`: UI, agent, Postgres, LiteLLM proxy
- `bytebot-desktop-worker`: the browser/desktop runtime only

You can run both resources on the same VPS in Coolify, but they should be separate applications. That gives you cleaner restarts, clearer monitoring, and an easier path to move the desktop worker to another server later.

## Files

- Core stack: `docker/docker-compose.isolated-core.yml`
- Desktop worker: `docker/docker-compose.desktop-worker.yml`

## Resource 1: bytebot-core

Create a Compose application in Coolify using:

`docker/docker-compose.isolated-core.yml`

Required environment variables:

- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL`
- `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` or `OPENAI_API_KEY`
- `OPENROUTER_API_KEY` if you use the LiteLLM OpenRouter models
- `BYTEBOT_DESKTOP_BASE_URL`
- `BYTEBOT_DESKTOP_VNC_URL`

Recommended values when the desktop worker is exposed by Coolify:

- `BYTEBOT_DESKTOP_BASE_URL=https://desktop-worker.example.com`
- `BYTEBOT_DESKTOP_VNC_URL=wss://desktop-worker.example.com/websockify`

If the worker is reachable only on an internal hostname:

- `BYTEBOT_DESKTOP_BASE_URL=http://bytebot-desktop-worker:9990`
- `BYTEBOT_DESKTOP_VNC_URL=ws://bytebot-desktop-worker:9990/websockify`

The UI will be exposed from `bytebot-ui`.
The API will be exposed from `bytebot-agent`.

## Resource 2: bytebot-desktop-worker

Create a second Compose application in Coolify using:

`docker/docker-compose.desktop-worker.yml`

Required environment variables:

- `BYTEBOT_DESKTOP_PORT=9990`
- `OPENROUTER_API_KEY` if the desktop worker must read `.env` mounted settings that rely on it

Expose the worker publicly only if the core stack cannot reach it internally. If you do expose it publicly, protect it behind a private domain or Coolify access controls.

## Recommended Topology

### Same VPS

- Coolify app `bytebot-core`
- Coolify app `bytebot-desktop-worker`

This is the easiest production setup.

### Split VPS

- VPS 1: `bytebot-core`
- VPS 2: `bytebot-desktop-worker`

This is the better long-term setup if the desktop browser becomes heavy or unstable.

## Notes

- The agent only needs a valid `BYTEBOT_DESKTOP_BASE_URL`.
- The UI only needs a valid `BYTEBOT_DESKTOP_VNC_URL`.
- Isolation does not change agent logic. It changes only where the desktop runtime lives.
- If the desktop worker crashes, the core platform can stay online.
