/**
 * A callback is honoured only for a state this process issued.
 *
 * Three of the four OAuth services used to accept any state whenever no flow
 * was pending, which is the normal condition. That let a callback nobody
 * started attach an account.
 */
import { describe, expect, test } from 'bun:test'
import { instagram } from '../../app/Services/Social/InstagramService'
import { linkedin } from '../../app/Services/Social/LinkedInService'
import { threads } from '../../app/Services/Social/ThreadsService'
import { twitter } from '../../app/Services/Social/TwitterService'

const services = { instagram, linkedin, threads, twitter }

describe('oauth callback state', () => {
  test.each(Object.keys(services))('%s refuses a state it never issued', async (name) => {
    const service = services[name as keyof typeof services]

    await expect(service.handleCallback('any-code', 'never-issued')).rejects.toThrow(/state mismatch/i)
  })

  test.each(Object.keys(services))('%s refuses an empty state', async (name) => {
    const service = services[name as keyof typeof services]

    await expect(service.handleCallback('any-code', '')).rejects.toThrow(/state mismatch/i)
  })
})
