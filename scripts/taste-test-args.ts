import { DEFAULT_LLM_PROVIDER, type LLMProvider } from '../app/lib/llm'

export const LLM_PROVIDERS: LLMProvider[] = ['anthropic', 'openai', 'deepseek', 'gemini']

export function isBaseUrl(value: string | undefined): value is string {
  return !!value && (value.startsWith('http://') || value.startsWith('https://'))
}

export function parseProvider(value: string | undefined): LLMProvider {
  if (!value) return DEFAULT_LLM_PROVIDER
  if (isBaseUrl(value)) {
    throw new Error(
      `"${value}" is a base URL, not an LLM provider. ` +
        `Use: ./scripts/taste-test-all.sh <base-url> [max-rounds] [count]`,
    )
  }
  if (!LLM_PROVIDERS.includes(value as LLMProvider)) {
    throw new Error(`Unknown provider "${value}". Use one of: ${LLM_PROVIDERS.join(', ')}`)
  }
  return value as LLMProvider
}

/** taste-test-all: [base-url|provider] [max-rounds] [count] */
export function parseTasteTestAllArgs(argv: string[]) {
  const arg1 = argv[2]
  if (isBaseUrl(arg1)) {
    return {
      baseUrl: arg1.replace(/\/$/, ''),
      provider: DEFAULT_LLM_PROVIDER,
      maxRounds: Number(argv[3] ?? 20),
      count: Number(argv[4] ?? 5),
    }
  }
  return {
    baseUrl: undefined as string | undefined,
    provider: parseProvider(arg1),
    maxRounds: Number(argv[3] ?? 20),
    count: Number(argv[4] ?? 5),
  }
}

/** taste-test: <preference> [base-url|provider] [max-rounds] */
export function parseTasteTestArgs(argv: string[]) {
  const preference = argv[2]?.trim()
  const arg2 = argv[3]
  if (isBaseUrl(arg2)) {
    return {
      preference,
      baseUrl: arg2.replace(/\/$/, ''),
      provider: DEFAULT_LLM_PROVIDER,
      maxRounds: Number(argv[4] ?? 20),
    }
  }
  return {
    preference,
    baseUrl: undefined as string | undefined,
    provider: parseProvider(arg2),
    maxRounds: Number(argv[4] ?? 20),
  }
}
