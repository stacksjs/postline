/**
 * Sign out everywhere (#93): every token the owner has stops working, and the
 * route needs a session to start with.
 */
import { describe, expect, test } from 'bun:test'
import { Auth, createToken } from '@stacksjs/auth'
import { featureTest } from '@stacksjs/testing'
import User from '../../storage/framework/defaults/app/Models/User'

async function owner() {
  return await User.first() ?? await User.create({
    name: 'Everywhere Test',
    email: `everywhere-${Date.now()}@postline.test`,
    password: 'not-used-tokens-are-created-directly',
  })
}

describe('sign out everywhere', () => {
  test('without a session it is refused', async () => {
    const response = await featureTest().post('/api/logout-all', {})
    expect(response.status).toBe(401)
  })

  test('every token the owner has stops working, the one used included', async () => {
    const user = await owner()
    const laptop = await createToken(Number(user.id), 'laptop')
    const phone = await createToken(Number(user.id), 'phone')
    expect(await Auth.getUserFromToken(laptop.plainTextToken)).toBeTruthy()

    const response = await featureTest()
      .withHeaders({ Authorization: `Bearer ${laptop.plainTextToken}` })
      .post('/api/logout-all', {})

    expect(response.status).toBe(200)
    expect(await Auth.getUserFromToken(laptop.plainTextToken)).toBeFalsy()
    expect(await Auth.getUserFromToken(phone.plainTextToken)).toBeFalsy()
  })
})
