import type { AIProvider } from './types'

type ProviderName = 'gemini' | 'claude' | 'openai'

let providerInstance: AIProvider | null = null

export async function getAIProvider(): Promise<AIProvider> {
  if (providerInstance) return providerInstance

  const activeProvider = (process.env.ACTIVE_AI_PROVIDER ?? 'gemini') as ProviderName

  switch (activeProvider) {
    case 'claude': {
      const { ClaudeProvider } = await import('./claude')
      providerInstance = new ClaudeProvider()
      break
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./openai')
      providerInstance = new OpenAIProvider()
      break
    }
    case 'gemini':
    default: {
      const { GeminiProvider } = await import('./gemini')
      providerInstance = new GeminiProvider()
      break
    }
  }

  return providerInstance
}
