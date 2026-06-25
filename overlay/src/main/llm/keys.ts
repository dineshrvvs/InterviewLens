import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface ApiKeys {
  GEMINI?: string
  GROQ?: string
  OPENROUTER?: string
}

let loadedKeys: ApiKeys | null = null

/**
 * Loads API keys from environment variables, secure storage, or local JSON.
 * Migrates local JSON keys to secure storage automatically if possible.
 */
export function getApiKeys(): ApiKeys {
  if (loadedKeys) {
    return loadedKeys
  }

  const keys: ApiKeys = {}

  // 1) Load keys from environment variables (highest priority)
  if (process.env.GEMINI_API_KEY) keys.GEMINI = process.env.GEMINI_API_KEY
  if (process.env.GROQ_API_KEY) keys.GROQ = process.env.GROQ_API_KEY
  if (process.env.OPENROUTER_API_KEY) keys.OPENROUTER = process.env.OPENROUTER_API_KEY

  // 2) Try loading keys from the secure userData directory
  const securePath = join(app.getPath('userData'), 'keys.secure.json')
  if (existsSync(securePath)) {
    try {
      const data = JSON.parse(readFileSync(securePath, 'utf8'))
      const decrypted: ApiKeys = {}

      const decrypt = (val?: string) => {
        if (!val) return undefined
        if (!safeStorage.isEncryptionAvailable()) {
          return val // fallback to plaintext if encryption is unavailable
        }
        try {
          return safeStorage.decryptString(Buffer.from(val, 'hex'))
        } catch (err) {
          console.warn('[Keys] Failed to decrypt key, attempting plaintext fallback:', err)
          return val
        }
      }

      if (data.GEMINI) decrypted.GEMINI = decrypt(data.GEMINI)
      if (data.GROQ) decrypted.GROQ = decrypt(data.GROQ)
      if (data.OPENROUTER) decrypted.OPENROUTER = decrypt(data.OPENROUTER)

      Object.assign(keys, decrypted)
    } catch (err) {
      console.error('[Keys] Error loading secure keys:', err)
    }
  }

  // 3) Try loading from gitignored local keys.local.json file (in dev)
  const localPath = join(process.cwd(), 'keys.local.json')
  if (existsSync(localPath)) {
    try {
      const data = JSON.parse(readFileSync(localPath, 'utf8'))
      const localKeys: ApiKeys = {}

      if (data.GEMINI_API_KEY) localKeys.GEMINI = data.GEMINI_API_KEY
      if (data.GROQ_API_KEY) localKeys.GROQ = data.GROQ_API_KEY
      if (data.OPENROUTER_API_KEY) localKeys.OPENROUTER = data.OPENROUTER_API_KEY

      // Merge local keys in
      Object.assign(keys, localKeys)

      // Encrypt and migrate them to secure userData file
      const encrypted: any = {}
      const encrypt = (val: string) => {
        if (!safeStorage.isEncryptionAvailable()) {
          return val
        }
        return safeStorage.encryptString(val).toString('hex')
      }

      if (localKeys.GEMINI) encrypted.GEMINI = encrypt(localKeys.GEMINI)
      if (localKeys.GROQ) encrypted.GROQ = encrypt(localKeys.GROQ)
      if (localKeys.OPENROUTER) encrypted.OPENROUTER = encrypt(localKeys.OPENROUTER)

      writeFileSync(securePath, JSON.stringify(encrypted, null, 2), 'utf8')
      console.log(`[Keys] API keys from keys.local.json successfully encrypted and saved to: ${securePath}`)
    } catch (err) {
      console.error('[Keys] Error parsing keys.local.json:', err)
    }
  }

  loadedKeys = keys
  return keys
}

/**
 * Saves and encrypts API keys from UI Settings securely.
 */
export function saveApiKeys(newKeys: ApiKeys): void {
  const securePath = join(app.getPath('userData'), 'keys.secure.json')
  const encrypted: any = {}

  const encrypt = (val: string) => {
    if (!val) return undefined
    if (!safeStorage.isEncryptionAvailable()) {
      return val
    }
    return safeStorage.encryptString(val).toString('hex')
  }

  // Preserve existing keys from keys.secure.json if new keys are masked/empty
  try {
    if (existsSync(securePath)) {
      const secureData = JSON.parse(readFileSync(securePath, 'utf8'))
      // These are already encrypted hex strings, so we can preserve them directly if the user didn't enter a new key
      Object.assign(encrypted, secureData)
    }
  } catch (err) {
    console.warn('[Keys] Error reading existing secure keys during save:', err)
  }

  const handleKeySave = (name: 'GEMINI' | 'GROQ' | 'OPENROUTER', val?: string) => {
    if (val === undefined || val === '') {
      // If key is cleared or empty, remove it
      delete encrypted[name]
    } else if (val === '••••••••') {
      // Keep existing key (do nothing, it's already in encrypted object)
    } else {
      // Encrypt and update the key
      encrypted[name] = encrypt(val)
    }
  }

  handleKeySave('GEMINI', newKeys.GEMINI)
  handleKeySave('GROQ', newKeys.GROQ)
  handleKeySave('OPENROUTER', newKeys.OPENROUTER)

  writeFileSync(securePath, JSON.stringify(encrypted, null, 2), 'utf8')
  console.log(`[Keys] API keys successfully saved and encrypted to: ${securePath}`)

  // Clear cache and reload keys so that next calls to getApiKeys() retrieve the updated values
  loadedKeys = null
  getApiKeys()
}

