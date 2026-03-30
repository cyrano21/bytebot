import { ANTHROPIC_MODELS } from '../anthropic/anthropic.constants';
import { OPENAI_MODELS } from '../openai/openai.constants';
import { GOOGLE_MODELS } from '../google/google.constants';
import { BytebotAgentModel } from '../agent/agent.types';
import {
  getConfiguredDefaultModelName,
  loadModelConfig,
  loadCustomModels,
} from './custom-models.constants';

const OLLAMA_MODEL_CACHE_TTL_MS = 30_000;

let installedOllamaModelsCache:
  | {
      expiresAt: number;
      models: Set<string>;
    }
  | null = null;

type ModelCooldown = {
  expiresAt: number;
  reason: string;
};

const temporarilyUnavailableModels = new Map<string, ModelCooldown>();
const temporarilyUnavailableProviders = new Map<string, ModelCooldown>();
const DISABLED_PROXY_MODELS = new Set([
  'healer-alpha',
  'openrouter-mistral-small-vision-free',
]);

function isLikelyAnthropicApiKey(apiKey?: string | null): boolean {
  const normalizedKey = apiKey?.trim();
  return Boolean(normalizedKey && normalizedKey.startsWith('sk-ant-'));
}

function isLikelyOpenAIApiKey(apiKey?: string | null): boolean {
  const normalizedKey = apiKey?.trim();
  if (!normalizedKey) {
    return false;
  }

  if (normalizedKey.startsWith('sk-or-v1-')) {
    return false;
  }

  return normalizedKey.startsWith('sk-');
}

function isLikelyGeminiApiKey(apiKey?: string | null): boolean {
  const normalizedKey = apiKey?.trim();
  if (!normalizedKey) {
    return false;
  }

  return /^AIza[0-9A-Za-z\-_]{20,}$/.test(normalizedKey);
}

function hasNonEmptyApiKey(apiKey?: string | null): boolean {
  return Boolean(apiKey?.trim());
}

function isLikelyOpenRouterApiKey(apiKey?: string | null): boolean {
  const normalizedKey = apiKey?.trim();
  return Boolean(normalizedKey && normalizedKey.startsWith('sk-or-v1-'));
}

function isLikelyGroqApiKey(apiKey?: string | null): boolean {
  const normalizedKey = apiKey?.trim();
  return Boolean(normalizedKey && normalizedKey.startsWith('gsk_'));
}

function isLikelyHuggingFaceApiKey(apiKey?: string | null): boolean {
  const normalizedKey = apiKey?.trim();
  return Boolean(normalizedKey && normalizedKey.startsWith('hf_'));
}

function isLikelyDeepSeekApiKey(apiKey?: string | null): boolean {
  const normalizedKey = apiKey?.trim();
  return Boolean(normalizedKey && normalizedKey.startsWith('sk-'));
}

function hasRuntimeSupportForProxyModel(modelName: string): boolean {
  const normalizedName = modelName.toLowerCase();

  if (DISABLED_PROXY_MODELS.has(normalizedName)) {
    return false;
  }

  if (normalizedName.startsWith('ollama-')) {
    return true;
  }

  if (normalizedName.startsWith('groq-')) {
    return isLikelyGroqApiKey(process.env.GROQ_API_KEY);
  }

  if (normalizedName.startsWith('mistral-')) {
    return hasNonEmptyApiKey(process.env.MISTRAL_API_KEY);
  }

  if (normalizedName.startsWith('gemini-')) {
    return isLikelyGeminiApiKey(process.env.GEMINI_API_KEY);
  }

  if (normalizedName.startsWith('huggingface-')) {
    return isLikelyHuggingFaceApiKey(process.env.HUGGINGFACE_API_KEY);
  }

  if (normalizedName.startsWith('deepseek-')) {
    return isLikelyDeepSeekApiKey(process.env.DEEPSEEK_API_KEY);
  }

  if (normalizedName.startsWith('grok-')) {
    return hasNonEmptyApiKey(process.env.XAI_API_KEY);
  }

  if (
    normalizedName.startsWith('openrouter-') ||
    normalizedName.startsWith('kimi-') ||
    normalizedName.endsWith('-free')
  ) {
    return isLikelyOpenRouterApiKey(process.env.OPENROUTER_API_KEY);
  }

  return true;
}

function getModelKey(model: BytebotAgentModel): string {
  return `${model.provider}:${model.name}`;
}

function pruneExpiredCooldowns(): void {
  const now = Date.now();

  for (const [key, cooldown] of temporarilyUnavailableModels.entries()) {
    if (cooldown.expiresAt <= now) {
      temporarilyUnavailableModels.delete(key);
    }
  }

  for (const [provider, cooldown] of temporarilyUnavailableProviders.entries()) {
    if (cooldown.expiresAt <= now) {
      temporarilyUnavailableProviders.delete(provider);
    }
  }
}

function isTemporarilyUnavailable(model: BytebotAgentModel): boolean {
  pruneExpiredCooldowns();

  const providerCooldown = temporarilyUnavailableProviders.get(model.provider);
  if (providerCooldown && providerCooldown.expiresAt > Date.now()) {
    return true;
  }

  const modelCooldown = temporarilyUnavailableModels.get(getModelKey(model));
  return Boolean(modelCooldown && modelCooldown.expiresAt > Date.now());
}

export function markModelTemporarilyUnavailable(
  model: BytebotAgentModel,
  cooldownMs: number,
  reason: string,
  scope: 'model' | 'provider' = 'model',
): void {
  const expiresAt = Date.now() + Math.max(1_000, cooldownMs);
  const cooldown: ModelCooldown = {
    expiresAt,
    reason,
  };

  pruneExpiredCooldowns();

  if (scope === 'provider') {
    temporarilyUnavailableProviders.set(model.provider, cooldown);
    return;
  }

  temporarilyUnavailableModels.set(getModelKey(model), cooldown);
}

function getModelExecutionScore(model: BytebotAgentModel): number {
  let score = 0;
  const modelName = model.name.toLowerCase();

  switch (model.provider) {
    case 'google':
      score += 50;
      break;
    case 'anthropic':
      score += 45;
      break;
    case 'openai':
      score += 40;
      break;
    case 'proxy':
      score += 30;
      break;
    default:
      score += 20;
      break;
  }

  if (modelName.includes('flash')) {
    score += 25;
  }
  if (modelName.includes('sonnet')) {
    score += 22;
  }
  if (modelName.includes('gpt-4.1')) {
    score += 18;
  }
  if (modelName.includes('gemma') || modelName.includes('llama')) {
    score += 14;
  }
  if (modelName.includes('7b') || modelName.includes('8b')) {
    score += 12;
  }
  if (modelName.includes('opus')) {
    score -= 10;
  }
  if (modelName.includes('o3')) {
    score -= 8;
  }
  if (
    modelName.includes('30b') ||
    modelName.includes('32b') ||
    modelName.includes('qwq') ||
    modelName.includes('r1')
  ) {
    score -= 18;
  }

  return score;
}

function dedupeModels(models: BytebotAgentModel[]): BytebotAgentModel[] {
  const seen = new Set<string>();

  return models.filter((model) => {
    const key = `${model.provider}:${model.name}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function selectDefaultModel(
  availableModels: BytebotAgentModel[],
): BytebotAgentModel | null {
  if (availableModels.length === 0) {
    return null;
  }

  const configuredDefaultModel =
    process.env.BYTEBOT_DEFAULT_MODEL || getConfiguredDefaultModelName();

  if (configuredDefaultModel) {
    const explicitDefault = availableModels.find(
      (model) =>
        model.name === configuredDefaultModel ||
        model.title === configuredDefaultModel,
    );

    if (explicitDefault) {
      return explicitDefault;
    }
  }

  return [...availableModels].sort((left, right) => {
    const scoreDelta =
      getModelExecutionScore(right) - getModelExecutionScore(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.title.localeCompare(right.title);
  })[0];
}

export function findMatchingModel(
  availableModels: BytebotAgentModel[],
  requestedModel?: BytebotAgentModel | null,
): BytebotAgentModel | null {
  if (!requestedModel) {
    return null;
  }

  return (
    availableModels.find(
      (model) =>
        model.provider === requestedModel.provider &&
        model.name === requestedModel.name,
    ) ??
    availableModels.find(
      (model) =>
        model.provider === requestedModel.provider &&
        model.title === requestedModel.title,
    ) ??
    null
  );
}

function getConfiguredModels(): BytebotAgentModel[] {
  const customModels = loadCustomModels().filter(
    (model) =>
      model.provider === 'anthropic' ||
      model.provider === 'openai' ||
      model.provider === 'google' ||
      model.provider === 'proxy' ||
      model.provider === 'custom',
  );

  return dedupeModels([
    ...(isLikelyAnthropicApiKey(process.env.ANTHROPIC_API_KEY)
      ? ANTHROPIC_MODELS
      : []),
    ...(isLikelyOpenAIApiKey(process.env.OPENAI_API_KEY) ? OPENAI_MODELS : []),
    ...(isLikelyGeminiApiKey(process.env.GEMINI_API_KEY) ? GOOGLE_MODELS : []),
    ...customModels,
  ]);
}

function getConfiguredOllamaAliasMap(): Map<string, string> {
  const config = loadModelConfig();
  const aliasMap = new Map<string, string>();

  for (const [key, modelName] of Object.entries(config?.models ?? {})) {
    if (!key.startsWith('ollama_') || typeof modelName !== 'string') {
      continue;
    }

    aliasMap.set(key.replace(/_/g, '-'), modelName.toLowerCase());
  }

  return aliasMap;
}

async function getInstalledOllamaModels(): Promise<Set<string> | null> {
  if (
    installedOllamaModelsCache &&
    installedOllamaModelsCache.expiresAt > Date.now()
  ) {
    return installedOllamaModelsCache.models;
  }

  const baseUrls = [
    process.env.BYTEBOT_OLLAMA_URL,
    'http://127.0.0.1:11434',
    'http://host.docker.internal:11434',
  ].filter((value): value is string => Boolean(value));

  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1_500),
      });

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      if (!Array.isArray(payload?.models)) {
        continue;
      }

      const models = new Set<string>();
      for (const model of payload.models) {
        if (typeof model?.name === 'string') {
          models.add(model.name.toLowerCase());
        }
        if (typeof model?.model === 'string') {
          models.add(model.model.toLowerCase());
        }
      }

      installedOllamaModelsCache = {
        expiresAt: Date.now() + OLLAMA_MODEL_CACHE_TTL_MS,
        models,
      };

      return models;
    } catch {
      continue;
    }
  }

  return null;
}

async function filterUnavailableProxyModels(
  models: BytebotAgentModel[],
): Promise<BytebotAgentModel[]> {
  const configuredOllamaAliases = getConfiguredOllamaAliasMap();
  const installedOllamaModels =
    configuredOllamaAliases.size > 0 ? await getInstalledOllamaModels() : null;

  return models.filter((model) => {
    if (model.provider !== 'proxy') {
      return true;
    }

    if (!hasRuntimeSupportForProxyModel(model.name)) {
      return false;
    }

    if (!model.name.startsWith('ollama-')) {
      return true;
    }

    if (!installedOllamaModels) {
      return false;
    }

    const actualModelName = configuredOllamaAliases.get(model.name);
    if (!actualModelName) {
      return false;
    }

    return installedOllamaModels.has(actualModelName);
  });
}

async function getProxyModels(): Promise<BytebotAgentModel[]> {
  const proxyUrl = process.env.BYTEBOT_LLM_PROXY_URL;
  if (!proxyUrl) {
    return [];
  }

  try {
    const response = await fetch(`${proxyUrl}/model/info`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const proxyModels = await response.json();
    if (!Array.isArray(proxyModels?.data)) {
      return [];
    }

    return proxyModels.data
      .filter((model: any) => typeof model?.model_name === 'string')
      .map(
        (model: any): BytebotAgentModel => ({
          provider: 'proxy',
          name: model.model_name,
          title: model.model_name,
          contextWindow: 128000,
        }),
      );
  } catch {
    return [];
  }
}

function sortModels(models: BytebotAgentModel[]): BytebotAgentModel[] {
  const providerRank: Record<string, number> = {
    anthropic: 0,
    openai: 1,
    google: 2,
    proxy: 3,
    custom: 4,
  };

  return [...models].sort((left, right) => {
    const providerDelta =
      (providerRank[left.provider] ?? 99) - (providerRank[right.provider] ?? 99);
    if (providerDelta !== 0) {
      return providerDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

export async function getAvailableModels(): Promise<BytebotAgentModel[]> {
  const configuredModels = getConfiguredModels();
  const proxyModels = await getProxyModels();
  const proxyReachable = proxyModels.length > 0;
  const eligibleModels = await filterUnavailableProxyModels(
    dedupeModels([
      ...proxyModels,
      ...configuredModels.filter(
        (model) => model.provider !== 'proxy' || proxyReachable,
      ),
    ]),
  );

  const availableModels = sortModels(
    eligibleModels.filter((model) => !isTemporarilyUnavailable(model)),
  );
  const defaultModel = selectDefaultModel(availableModels);

  if (!defaultModel) {
    return availableModels;
  }

  return [
    defaultModel,
    ...availableModels.filter(
      (model) =>
        !(
          model.provider === defaultModel.provider &&
          model.name === defaultModel.name
        ),
    ),
  ];
}

export async function getDefaultModel(): Promise<BytebotAgentModel | null> {
  const availableModels = await getAvailableModels();
  return selectDefaultModel(availableModels);
}

export async function resolveExecutableModel(
  requestedModel?: BytebotAgentModel | null,
): Promise<{
  model: BytebotAgentModel | null;
  usedFallback: boolean;
}> {
  const availableModels = await getAvailableModels();
  const matchedModel = findMatchingModel(availableModels, requestedModel);

  if (matchedModel) {
    return {
      model: matchedModel,
      usedFallback: false,
    };
  }

  return {
    model: selectDefaultModel(availableModels),
    usedFallback: Boolean(requestedModel),
  };
}

export async function getFallbackModels(
  currentModel?: BytebotAgentModel | null,
): Promise<BytebotAgentModel[]> {
  const availableModels = await getAvailableModels();

  return [...availableModels]
    .filter((model) => {
      if (!currentModel) {
        return true;
      }

      return !(
        model.provider === currentModel.provider &&
        model.name === currentModel.name
      );
    })
    .sort((left, right) => {
      const scoreDelta =
        getModelExecutionScore(right) - getModelExecutionScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.title.localeCompare(right.title);
    });
}
