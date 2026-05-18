import { DEFAULT_LLM_PROVIDER, type LLMProvider } from '@/app/lib/llm'

const ENV_KEY: Record<LLMProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

export function llmProviderApiKey(provider: LLMProvider): string | undefined {
  const v = process.env[ENV_KEY[provider]]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export function parseLlmProvider(raw: string | null | undefined): LLMProvider {
  if (raw === 'anthropic' || raw === 'openai' || raw === 'deepseek' || raw === 'gemini') {
    return raw
  }
  return DEFAULT_LLM_PROVIDER
}

/** Single user turn with system prompt — used by career discography, artist suggest, etc. */
export async function askLlmSimpleChat(
  system: string,
  user: string,
  provider: LLMProvider = DEFAULT_LLM_PROVIDER,
  maxTokens = 4096
): Promise<string> {
  const apiKey = llmProviderApiKey(provider)
  if (!apiKey) {
    throw new Error(`${ENV_KEY[provider]} is not configured on the server`)
  }

  switch (provider) {
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`OpenAI HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
      }
      const data = await res.json()
      return data.choices[0].message.content as string
    }
    case 'gemini': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Gemini HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
      }
      const data = await res.json()
      return data.candidates[0].content.parts[0].text as string
    }
    case 'deepseek': {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`DeepSeek HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
      }
      const data = await res.json()
      return data.choices[0].message.content as string
    }
    default: {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          payload?.error?.message?.trim() ||
          `Anthropic HTTP ${res.status}`
        throw new Error(msg)
      }
      const block = payload.content?.find(
        (c: { type?: string; text?: string }) => c.type === 'text' && typeof c.text === 'string'
      )
      const text = block?.text ?? ''
      if (!text) throw new Error('Empty Anthropic response')
      return text
    }
  }
}
