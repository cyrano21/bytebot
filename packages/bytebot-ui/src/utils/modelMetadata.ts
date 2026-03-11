import { Model } from "@/types";

/**
 * Métadonnées des modèles avec descriptions et statuts
 */
const MODEL_METADATA: Record<
  string,
  {
    description: string;
    badge: string;
    status: "free" | "paid" | "limited" | "offline";
  }
> = {
  // Groq - Ultra-rapide et gratuit
  "groq-llama-3.3": {
    description: "Llama 3.3 70b - Ultra-puissant et très rapide",
    badge: "✅ Gratuit",
    status: "free",
  },
  "groq-llama-3.1-8b": {
    description: "Llama 3.1 8b - Petit mais très rapide",
    badge: "✅ Gratuit",
    status: "free",
  },
  "groq-qwen-3.2b": {
    description: "Qwen 3 32b - Modèle récent et performant",
    badge: "✅ Gratuit",
    status: "free",
  },

  // Mistral - Gratuit avec limite
  "mistral-small": {
    description: "Mistral Small - Rapide et léger",
    badge: "✅ Gratuit (limite)",
    status: "limited",
  },
  "mistral-medium": {
    description: "Mistral Medium - Équilibre qualité/vitesse",
    badge: "✅ Gratuit (limite)",
    status: "limited",
  },
  "mistral-large": {
    description: "Mistral Large - Très puissant mais lent",
    badge: "✅ Gratuit (limite)",
    status: "limited",
  },

  // Ollama - Gratuit local
  "llama3.1": {
    description: "Llama 3.1 - Modèle local haute performance",
    badge: "✅ Gratuit (Local)",
    status: "free",
  },
  codellama: {
    description: "CodeLlama - Spécialisé pour la programmation",
    badge: "✅ Gratuit (Local)",
    status: "free",
  },
  mistral: {
    description: "Mistral - Modèle local équilibré",
    badge: "✅ Gratuit (Local)",
    status: "free",
  },

  // OpenRouter - Payant et crédits épuisés
  "openrouter-claude": {
    description: "Claude 3.5 Sonnet - Très puissant mais cher",
    badge: "❌ Payant (Crédits épuisés)",
    status: "paid",
  },
  "openrouter-gpt": {
    description: "GPT-4o - Excellent modèle d&apos;OpenAI",
    badge: "❌ Payant (Crédits épuisés)",
    status: "paid",
  },
  "llama-3.1-8b-free": {
    description: "Llama 3.1 8b via OpenRouter",
    badge: "❌ Payant (Crédits épuisés)",
    status: "paid",
  },
  "qwen2-vl-free": {
    description: "Qwen 2 VL via OpenRouter",
    badge: "❌ Payant (Crédits épuisés)",
    status: "paid",
  },

  // Google Gemini - Gratuit (avec limite)
  "gemini-2.0-flash": {
    description: "Gemini 2.0 Flash - Ultra-rapide et gratuit",
    badge: "✅ Gratuit",
    status: "free",
  },
  "gemini-1.5-pro": {
    description: "Gemini 1.5 Pro - Puissant et multimodal",
    badge: "✅ Gratuit",
    status: "free",
  },

  // Hugging Face - Gratuit avec limite
  "huggingface-mistral-7b": {
    description: "Mistral 7B via Hugging Face",
    badge: "✅ Gratuit (limite)",
    status: "limited",
  },
  "huggingface-llama-2-7b": {
    description: "Llama 2 7B via Hugging Face",
    badge: "✅ Gratuit (limite)",
    status: "limited",
  },

  // DeepSeek - Gratuit et très puissant
  "deepseek-chat": {
    description: "DeepSeek Chat - Excellent pour la conversation",
    badge: "✅ Gratuit",
    status: "free",
  },
  "deepseek-coder": {
    description: "DeepSeek Coder - Spécialisé en programmation",
    badge: "✅ Gratuit",
    status: "free",
  },

  // xAI Grok - Ultra-puissant et gratuit
  "grok-2": {
    description: "Grok 2 - Modèle ultra-puissant d&apos;xAI",
    badge: "✅ Gratuit",
    status: "free",
  },
  "grok-3": {
    description: "Grok 3 - Dernier modèle Grok (expérimental)",
    badge: "✅ Gratuit",
    status: "free",
  },

  // Kimi K2 - Multilingue gratuit
  "kimi-k2": {
    description: "Kimi K2 - Modèle multilingue avancé",
    badge: "✅ Gratuit",
    status: "free",
  },
};

/**
 * Enrichit un modèle avec les métadonnées (description, badge, statut)
 */
export function enrichModel(model: Model): Model {
  if (model.description && model.badge && model.status) {
    return model;
  }

  const metadata = MODEL_METADATA[model.name];

  if (metadata) {
    return {
      ...model,
      description: model.description || metadata.description,
      badge: model.badge || metadata.badge,
      status: model.status || metadata.status,
    };
  }

  // Fallback pour les modèles inconnus
  return {
    ...model,
    description: model.description || `${model.provider} - ${model.name}`,
    badge: model.badge || "Disponible",
    status: model.status || "free",
  };
}

/**
 * Enrichit une liste de modèles
 */
export function enrichModels(models: Model[]): Model[] {
  return models.map(enrichModel);
}

/**
 * Obtient l'icône de statut basée sur le type
 */
export function getStatusIcon(status?: string): string {
  switch (status) {
    case "free":
      return "✅";
    case "paid":
      return "❌";
    case "limited":
      return "⚠️";
    case "offline":
      return "🔴";
    default:
      return "❓";
  }
}

/**
 * Obtient la couleur de badge basée sur le statut
 */
export function getStatusColor(status?: string): string {
  switch (status) {
    case "free":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "paid":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "limited":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "offline":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}
