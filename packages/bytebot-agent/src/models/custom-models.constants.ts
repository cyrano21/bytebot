import { BytebotAgentModel } from '../agent/agent.types';
import * as fs from 'fs';
import * as path from 'path';
import * as toml from 'toml';

type RawModelConfig = {
  models?: Record<string, string>;
  default?: {
    model?: string;
  };
};

function resolveModelConfigPath(): string | null {
  const possiblePaths = [
    '/app/models.toml',
    path.join(process.cwd(), '..', '..', 'models.toml'),
    path.join(__dirname, '..', '..', '..', '..', 'models.toml'),
  ];

  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      return testPath;
    }
  }

  return null;
}

export function loadModelConfig(): RawModelConfig | null {
  try {
    const configPath = resolveModelConfigPath();
    if (!configPath) {
      console.warn(
        'Fichier models.toml non trouve, utilisation des modeles par defaut',
      );
      return null;
    }

    console.log(`[CUSTOM_MODELS] Chargement depuis: ${configPath}`);

    const configFile = fs.readFileSync(configPath, 'utf-8');
    return toml.parse(configFile) as RawModelConfig;
  } catch (error) {
    console.error(
      'Erreur lors du chargement de la configuration des modeles:',
      error,
    );
    return null;
  }
}

export function getConfiguredDefaultModelName(): string | null {
  const config = loadModelConfig();
  const configuredName = config?.default?.model;
  if (!configuredName) {
    return null;
  }

  return configuredName.replace(/_/g, '-');
}

// Fonction pour charger les modèles à partir du fichier models.toml
export function loadCustomModels(): BytebotAgentModel[] {
  try {
    const config = loadModelConfig();
    const modelsConfig = config?.models || {};
    const customModels: BytebotAgentModel[] = [];

    for (const [key, modelName] of Object.entries(modelsConfig)) {
      if (typeof modelName !== 'string') {
        continue;
      }

      customModels.push({
        provider: 'proxy',
        name: key.replace(/_/g, '-'),
        title: key.replace(/_/g, ' '),
        contextWindow: 128000,
      });
    }

    console.log(
      `[CUSTOM_MODELS] ${customModels.length} modeles personnalises charges`,
    );
    customModels.forEach((m) =>
      console.log(`  - ${m.title} (${m.provider}: ${m.name})`),
    );

    return customModels;
  } catch (error) {
    console.error(
      'Erreur lors du chargement des modeles personnalises:',
      error,
    );
    return [];
  }
}

// Charger les modèles personnalisés
export const CUSTOM_MODELS: BytebotAgentModel[] = loadCustomModels();
