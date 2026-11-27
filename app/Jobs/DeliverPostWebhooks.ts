import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { postWebhooks } from '../Services/PostWebhookService'
import { withHeartbeat } from '../Support/heartbeat'

export default new Job({
  name: 'DeliverPostWebhooks',
  description: 'Deliver Postline post events to the configured webhook recipient',
  queue: 'default',
  tries: 1,
  rate: Every.Minute,
  handle: async () => await withHeartbeat('DeliverPostWebhooks', () => postWebhooks.deliverDue()),
})
