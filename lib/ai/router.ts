import type { AIProvider } from './types'

/**
 * Returns the AI provider.
 *
 * There is exactly one: Groq. This used to switch on ACTIVE_AI_PROVIDER across
 * five providers, which meant a typo in that variable — or simply forgetting to
 * set it — silently selected Gemini instead, since Gemini was the `default`
 * branch. A misconfigured environment produced a working-looking app answering
 * with a different model than intended, which is not something you notice by
 * reading a transcript.
 *
 * One provider means one prompt path to reason about, one set of quirks (Groq's
 * native JSON mode), one key to configure, and one bill.
 */
let providerInstance: AIProvider | null = null

export async function getAIProvider(): Promise<AIProvider> {
  // Always re-create in development so model changes take effect without restart
  if (providerInstance && process.env.NODE_ENV === 'production') return providerInstance

  const { GroqProvider } = await import('./groq')
  providerInstance = new GroqProvider()
  return providerInstance
}
