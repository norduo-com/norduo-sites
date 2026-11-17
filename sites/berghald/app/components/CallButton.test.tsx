import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CallButton } from './CallButton'

describe('CallButton', () => {
  it('links to the number with the Icelandic country code and no spaces', () => {
    render(<CallButton phone="691 8944" />)
    const link = screen.getByRole('link', { name: 'Hringdu í 691 8944' })
    expect(link.getAttribute('href')).toBe('tel:+3546918944')
  })
})
