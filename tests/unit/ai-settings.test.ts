/**
 * The AI provider set in Settings (#138): stored sealed, never handed back,
 * and laid over config/ai.ts for planning.
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { aiSettings } from '../../app/Services/AISettingsService'
import { aiFailureReason, CampaignAIService } from '../../app/Services/CampaignAIService'

const database = db as any

describe('AI settings', () => {
  test('a saved key is sealed in the database and never returned', async () => {
    const view = await aiSettings.save({ provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-0123456789' })

    expect(view).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', hasKey: true })
    expect(JSON.stringify(view)).not.toContain('sk-ant-test')
    const row = await database.selectFrom('accounts').select(['ai_api_key']).executeTakeFirst()
    expect(String(row.ai_api_key)).toStartWith('enc:v1:')
    expect(String(row.ai_api_key)).not.toContain('sk-ant-test')
  })

  test('planning uses the provider, key and model from Settings', async () => {
    const config = await aiSettings.config() as any
    expect(config.default).toBe('anthropic')
    expect(config.drivers.anthropic.apiKey).toBe('sk-ant-test-0123456789')
    expect(config.drivers.anthropic.model).toBe('claude-sonnet-5-5')

    const configuration = await new CampaignAIService().configuration()
    expect(configuration.provider).toBe('anthropic')
    expect(configuration.configured).toBe(true)
  })

  test('saving without a key keeps the saved one; removing it clears it', async () => {
    expect((await aiSettings.save({ provider: 'anthropic', model: '' })).hasKey).toBe(true)
    expect((await aiSettings.save({ clearKey: true })).hasKey).toBe(false)
  })

  test('an unknown provider is refused', async () => {
    await expect(aiSettings.save({ provider: 'skynet' })).rejects.toThrow(/Anthropic, OpenAI or Ollama/)
  })

  test('with no provider saved, config/ai.ts decides as before', async () => {
    await aiSettings.save({ provider: '' })
    const config = await aiSettings.config() as any
    expect(config.drivers.anthropic?.apiKey).toBeUndefined()
  })
})

describe('why the provider did not answer', () => {
  test('each common failure is said in words the owner can act on', () => {
    expect(aiFailureReason(Object.assign(new Error('invalid x-api-key'), { status: 401 }), 'anthropic')).toBe('Anthropic refused the API key. Check it in Settings > AI.')
    expect(aiFailureReason(Object.assign(new Error('model: nope'), { status: 404 }), 'openai')).toContain('OpenAI does not know that model')
    expect(aiFailureReason(Object.assign(new Error('slow down'), { status: 429 }), 'anthropic')).toContain('rate limiting')
    expect(aiFailureReason(new Error('fetch failed'), 'ollama')).toBe('Ollama could not be reached.')
  })

  test('a key in an error message is never repeated', () => {
    expect(aiFailureReason(new Error('bad request for sk-ant-abcdefghijklmnop'), 'anthropic')).not.toContain('sk-ant-abcdefghijklmnop')
  })
})
