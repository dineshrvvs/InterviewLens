import { getApiKeys } from './keys'

export interface ResolvedProvider {
  name: string
  baseURL: string
  model: string
  key: string
}

/**
 * Resolves the configuration list of model providers to active provider configs
 * by matching the key references against available/decrypted API keys.
 */
export function resolveProviders(modeConfig: any): ResolvedProvider[] {
  const keys = getApiKeys()
  const resolved: ResolvedProvider[] = []

  for (const p of modeConfig.providers) {
    if (p.name === 'ollama') {
      resolved.push({
        name: p.name,
        baseURL: p.baseURL,
        model: p.model,
        key: 'ollama'
      })
      continue
    }

    const key = keys[p.keyRef as keyof typeof keys]
    if (key) {
      resolved.push({
        name: p.name,
        baseURL: p.baseURL,
        model: p.model,
        key: key
      })
    }
  }

  return resolved
}
