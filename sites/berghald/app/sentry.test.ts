import { describe, expect, it } from 'vitest'

import { scrubEvent } from './sentry'

describe('scrubEvent', () => {
  it('drops bodies, cookies, user, query and all but harmless headers', () => {
    const event = scrubEvent({
      user: { ip_address: '1.2.3.4' },
      request: {
        url: 'https://example.is/api/cms/enquiries',
        data: '{"email":"a@b.is"}',
        cookies: { CF_Authorization: 'x' },
        query_string: 'email=a@b.is',
        headers: {
          'User-Agent': 'Mozilla',
          'cf-connecting-ip': '1.2.3.4',
          'x-forwarded-for': '1.2.3.4',
          'cf-access-jwt-assertion': 'jwt',
          cookie: 'a=b',
        },
      },
    })
    expect(event).toEqual({
      request: {
        url: 'https://example.is/api/cms/enquiries',
        headers: { 'User-Agent': 'Mozilla' },
      },
    })
  })
})
