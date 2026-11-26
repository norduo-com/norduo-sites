import { describe, expect, it } from 'vitest'

import { gallery, schemaOf } from './fields'
import {
  coverIndex,
  galleryCover,
  type GalleryItem,
  parseVideoLink,
  videoEmbedUrl,
} from './gallery'
import { mediaIdsOf } from './media'

describe('parseVideoLink', () => {
  it('reads YouTube links in their usual shapes', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      ' https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ ',
    ])
      expect(parseVideoLink(url), url).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('reads Vimeo links, keeping the hash of an unlisted video', () => {
    expect(parseVideoLink('https://vimeo.com/76979871')).toEqual({
      provider: 'vimeo',
      id: '76979871',
    })
    expect(parseVideoLink('https://vimeo.com/channels/staffpicks/76979871')).toEqual({
      provider: 'vimeo',
      id: '76979871',
    })
    expect(parseVideoLink('https://vimeo.com/76979871/8272103f6e')).toEqual({
      provider: 'vimeo',
      id: '76979871',
      hash: '8272103f6e',
    })
    expect(parseVideoLink('https://player.vimeo.com/video/76979871?h=8272103f6e')).toEqual({
      provider: 'vimeo',
      id: '76979871',
      hash: '8272103f6e',
    })
  })

  it('refuses other sites, other schemes and links without a video', () => {
    for (const url of [
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
      'https://vimeo.com/about',
      'youtu.be/dQw4w9WgXcQ',
    ])
      expect(parseVideoLink(url), url).toBeNull()
  })

  it('gives the player URL to embed', () => {
    expect(videoEmbedUrl({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    )
    expect(videoEmbedUrl({ provider: 'vimeo', id: '1', hash: 'abcdef12' })).toBe(
      'https://player.vimeo.com/video/1?h=abcdef12',
    )
  })
})

const fields = { photos: gallery() }
const valid = (photos: unknown) => schemaOf(fields).safeParse({ photos }).success

describe('gallery()', () => {
  it('takes photos, videos with or without a poster, and YouTube/Vimeo links', () => {
    expect(
      valid([
        { kind: 'image', mediaId: 'a' },
        { kind: 'video', mediaId: 'v' },
        { kind: 'video', mediaId: 'w', poster: { mediaId: 'p' }, cover: true },
        { kind: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' },
      ]),
    ).toBe(true)
  })

  it('refuses a link that is not a YouTube or Vimeo video', () => {
    expect(valid([{ kind: 'embed', url: 'https://example.com/clip.mp4' }])).toBe(false)
  })

  it('refuses items without a kind, so old shapes are caught', () => {
    expect(valid([{ mediaId: 'a' }])).toBe(false)
  })

  it('allows one cover at most, and a video only with a poster', () => {
    expect(
      valid([
        { kind: 'image', mediaId: 'a', cover: true },
        { kind: 'image', mediaId: 'b', cover: true },
      ]),
    ).toBe(false)
    expect(valid([{ kind: 'video', mediaId: 'v', cover: true }])).toBe(false)
  })

  it('reports every photo it uses, posters included, and nothing for links', () => {
    const ids = mediaIdsOf(fields, {
      photos: [
        { kind: 'image', mediaId: 'a' },
        { kind: 'video', mediaId: 'v', poster: { mediaId: 'p' } },
        { kind: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' },
      ],
    })
    expect(ids).toEqual(['a', 'v', 'p'])
  })
})

describe('galleryCover', () => {
  const link: GalleryItem = { kind: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' }
  const video: GalleryItem = { kind: 'video', mediaId: 'v', poster: { mediaId: 'p' } }

  it('is the first photo when none is marked', () => {
    const items: GalleryItem[] = [link, video, { kind: 'image', mediaId: 'a' }]
    expect(coverIndex(items)).toBe(2)
    expect(galleryCover(items)).toEqual({ mediaId: 'a', alt: undefined })
  })

  it('is the marked item; for a video, its poster', () => {
    const items: GalleryItem[] = [
      { kind: 'image', mediaId: 'a' },
      { ...video, cover: true },
    ]
    expect(galleryCover(items)).toEqual({ mediaId: 'p' })
  })

  it('falls back to a video poster, and is null without any photo', () => {
    expect(galleryCover([link, video])).toEqual({ mediaId: 'p' })
    expect(galleryCover([link, { kind: 'video', mediaId: 'v' }])).toBeNull()
    expect(galleryCover(undefined)).toBeNull()
  })
})
