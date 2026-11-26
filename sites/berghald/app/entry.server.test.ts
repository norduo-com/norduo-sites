// @vitest-environment node
import { UNSAFE_ErrorResponseImpl as ErrorResponse } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleError } from './entry.server'

const captureException = vi.hoisted(() => vi.fn())
vi.mock('@sentry/cloudflare', () => ({ captureException }))

const args = (signal = new AbortController().signal) => ({
  request: new Request('https://example.is/', { signal }),
  params: {},
  context: undefined as never,
})

describe('handleError', () => {
  beforeEach(() => {
    captureException.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('reports a thrown error', () => {
    const error = new Error('boom')
    handleError(error, args())
    expect(captureException).toHaveBeenCalledWith(error)
  })

  it('reports a 5xx response', () => {
    handleError(new ErrorResponse(503, 'Service Unavailable', null), args())
    expect(captureException).toHaveBeenCalledOnce()
  })

  it('skips a 404 for an unknown URL', () => {
    handleError(new ErrorResponse(404, 'Not Found', null, true), args())
    expect(captureException).not.toHaveBeenCalled()
  })

  it('skips an aborted request', () => {
    const controller = new AbortController()
    controller.abort()
    handleError(new Error('gone'), args(controller.signal))
    expect(captureException).not.toHaveBeenCalled()
  })
})
