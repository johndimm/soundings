import type { LLMProvider } from '@/app/lib/llm'

/** One-off LLM call (category tree, etc.) — avoids circular imports with llm.ts. */
export async function callLLMRaw(
  provider: LLMProvider,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2000,
): Promise<string> {
  switch (provider) {
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1',
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      })
      if (!res.ok) throw new Error(`OpenAI responded with ${res.status}`)
      const data = await res.json()
      return data.choices[0].message.content as string
    }
    case 'deepseek': {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      })
      if (!res.ok) throw new Error(`DeepSeek responded with ${res.status}`)
      const data = await res.json()
      return data.choices[0].message.content as string
    }
    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userMessage }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        },
      )
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Gemini responded with ${res.status}: ${body}`)
      }
      const data = await res.json()
      return data.candidates[0].content.parts[0].text as string
    }
    default: {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })
      if (!res.ok) throw new Error(`Anthropic responded with ${res.status}`)
      const data = await res.json()
      return data.content[0].text as string
    }
  }
}
