#!/usr/bin/env node

const baseUrl = (
  process.argv[2] ||
  process.env.BYTEBOT_AGENT_BASE_URL ||
  'http://localhost:3000'
).replace(/\/+$/, '');
const apiPrefix = process.env.BYTEBOT_AGENT_API_PREFIX || '/api';

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  return response.json();
}

async function main() {
  const health = await fetchJson(`${apiPrefix}/health`);
  const models = await fetchJson(`${apiPrefix}/tasks/models`);
  const tasks = await fetchJson(`${apiPrefix}/tasks?limit=1`);

  if (!health?.service || !health?.agent || !health?.queue) {
    throw new Error('Health payload is missing operational fields');
  }

  if (!Array.isArray(models)) {
    throw new Error('/tasks/models did not return an array');
  }

  if (!Array.isArray(tasks?.tasks)) {
    throw new Error('/tasks did not return a paginated task payload');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        service: health.service,
        health: health.status,
        runnerId: health.agent.runnerId,
        leaseDurationMs: health.agent.leaseDurationMs,
        modelCount: models.length,
        queue: health.queue,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        baseUrl,
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
