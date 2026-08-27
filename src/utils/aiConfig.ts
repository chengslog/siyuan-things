export interface ResolvedSiYuanAIConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  providerId?: string;
  protocol?: string;
}

interface ModelEntry {
  provider: any;
  model: any;
}

function normalizeEndpoint(baseURL: unknown): string {
  const endpoint = String(baseURL || '').trim();
  if (!endpoint) return '';
  if (endpoint.endsWith('/chat/completions') || endpoint.endsWith('/completions')) {
    return endpoint;
  }
  return endpoint.replace(/\/$/, '') + '/chat/completions';
}

/** Resolve the enabled provider that owns the selected SiYuan model. */
export function resolveSiYuanAIConfig(
  aiConfig: any,
  preferredModel?: string,
): ResolvedSiYuanAIConfig | null {
  const providers = Array.isArray(aiConfig?.providers)
    ? aiConfig.providers.filter((provider: any) => provider && provider.enabled !== false)
    : [];

  const entries: ModelEntry[] = [];
  for (const provider of providers) {
    const models = Array.isArray(provider.models)
      ? provider.models.filter(
          (model: any) =>
            model &&
            model.enabled !== false &&
            (String(model.id || '').trim() || String(model.name || '').trim()),
        )
      : [];
    for (const model of models) entries.push({ provider, model });
  }

  if (entries.length === 0) return null;

  const candidates = [preferredModel, aiConfig?.agent?.modelId, aiConfig?.editing?.modelId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  let selected: ModelEntry | undefined;
  for (const candidate of candidates) {
    selected = entries.find(
      ({ model }) =>
        String(model.id || '').trim() === candidate ||
        String(model.name || '').trim() === candidate,
    );
    if (selected) break;
  }
  selected ||= entries[0];

  return {
    endpoint: normalizeEndpoint(selected.provider.baseURL),
    apiKey: String(selected.provider.apiKey || '').trim(),
    model: String(selected.model.name || selected.model.id || '').trim(),
    providerId: selected.provider.id,
    protocol: selected.provider.protocol,
  };
}
