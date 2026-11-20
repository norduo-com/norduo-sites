import { describe, expect, it } from 'vitest'

import { block, blocks, gallery, group, image, repeater, text } from './fields'
import { imageSrcSet, masterSize, mediaIdsOf } from './media'

describe('masterSize', () => {
  it('shrinks the long edge to 2560 and keeps the aspect ratio', () => {
    expect(masterSize(4032, 3024)).toEqual({ width: 2560, height: 1920 })
    expect(masterSize(3024, 4032)).toEqual({ width: 1920, height: 2560 })
  })

  it('never upscales', () => {
    expect(masterSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('imageSrcSet', () => {
  it('lists the four /img widths', () => {
    expect(imageSrcSet('abc')).toBe(
      '/img/480/abc 480w, /img/960/abc 960w, /img/1440/abc 1440w, /img/1920/abc 1920w',
    )
  })
})

describe('mediaIdsOf', () => {
  const fields = {
    title: text(),
    photo: image(),
    photos: gallery(),
    cta: group({ icon: image() }),
    steps: repeater({ pic: image(), label: text() }),
    sections: blocks({ hero: block({ background: image() }), plain: block({ t: text() }) }),
  }

  it('finds every image, also inside groups, repeaters and blocks, once each', () => {
    const ids = mediaIdsOf(fields, {
      title: 'x',
      photo: { mediaId: 'a' },
      photos: [{ mediaId: 'b' }, { mediaId: 'a' }],
      cta: { icon: { mediaId: 'c' } },
      steps: [{ pic: { mediaId: 'd' }, label: 'one' }, { label: 'two' }],
      sections: [
        { type: 'hero', data: { background: { mediaId: 'e' } } },
        { type: 'plain', data: { t: 'y' } },
      ],
    })
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('finds nothing in a document without images', () => {
    expect(mediaIdsOf(fields, { title: 'x' })).toEqual([])
  })
})
