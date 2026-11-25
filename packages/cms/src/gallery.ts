import { z } from 'zod'

/*
 * A gallery holds photos, MP4 videos stored in R2 and YouTube/Vimeo links, in the editor's
 * order. One photo, or a video with a poster, is the cover; without one, the first photo is.
 */

/** Largest MP4 Vefstjórn takes; longer videos go on YouTube or Vimeo. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024
export const VIDEO_TYPE = 'video/mp4'

export interface VideoLink {
  provider: 'youtube' | 'vimeo'
  id: string
  /** Vimeo's privacy hash of an unlisted video. */
  hash?: string
}

const YOUTUBE = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])
const VIMEO = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'])
const YOUTUBE_ID = /^[\w-]{11}$/
const VIMEO_ID = /^\d{1,12}$/
const VIMEO_HASH = /^[0-9a-f]{6,20}$/

/** The video a YouTube or Vimeo link points to, or null for any other link. */
export function parseVideoLink(raw: string): VideoLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be' || YOUTUBE.has(host)) {
    const id =
      host === 'youtu.be'
        ? parts[0]
        : parts[0] === 'watch'
          ? url.searchParams.get('v')
          : ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')
            ? parts[1]
            : undefined
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : null
  }

  if (VIMEO.has(host)) {
    // vimeo.com/<id>[/<hash>], vimeo.com/channels/<name>/<id>, player.vimeo.com/video/<id>?h=<hash>
    const at = parts.findIndex((p) => VIMEO_ID.test(p))
    const id = at === -1 ? undefined : parts[at]
    if (!id) return null
    const hash = url.searchParams.get('h') ?? parts[at + 1]
    return hash && VIMEO_HASH.test(hash)
      ? { provider: 'vimeo', id, hash }
      : { provider: 'vimeo', id }
  }
  return null
}

/** The player to put in an `<iframe>`; YouTube's no-cookie host sets no cookies until play. */
export function videoEmbedUrl(link: VideoLink): string {
  if (link.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${link.id}`
  return `https://player.vimeo.com/video/${link.id}${link.hash ? `?h=${link.hash}` : ''}`
}

const photo = z.object({ mediaId: z.string().min(1), alt: z.string().optional() })

export const galleryImage = photo.extend({
  kind: z.literal('image'),
  cover: z.literal(true).optional(),
})

export const galleryVideo = photo.extend({
  kind: z.literal('video'),
  /** A photo shown before the video plays; it stands for the video as the cover. */
  poster: photo.optional(),
  cover: z.literal(true).optional(),
})

export const galleryEmbed = z.object({
  kind: z.literal('embed'),
  url: z
    .string()
    .refine((v) => parseVideoLink(v) !== null, { message: 'Not a YouTube or Vimeo link' }),
  alt: z.string().optional(),
})

export const galleryItem = z.discriminatedUnion('kind', [galleryImage, galleryVideo, galleryEmbed])
export type GalleryItem = z.infer<typeof galleryItem>

const isCover = (item: GalleryItem) => item.kind !== 'embed' && item.cover === true

export const galleryValue = z
  .array(galleryItem)
  .refine((items) => items.filter(isCover).length <= 1, { message: 'More than one cover' })
  .refine((items) => items.every((i) => i.kind !== 'video' || !i.cover || i.poster), {
    message: 'A video cover needs a poster',
  })
export type GalleryValue = z.infer<typeof galleryValue>

/** Whether an item can be the cover: a photo, or a video with a poster. */
export const canBeCover = (item: GalleryItem) =>
  item.kind === 'image' || (item.kind === 'video' && item.poster !== undefined)

/** Index of the cover: the one marked, else the first photo, else the first video poster. */
export function coverIndex(items: readonly GalleryItem[] | undefined): number {
  if (!items) return -1
  const marked = items.findIndex((i) => isCover(i) && canBeCover(i))
  if (marked !== -1) return marked
  const first = items.findIndex((i) => i.kind === 'image')
  return first !== -1 ? first : items.findIndex(canBeCover)
}

/** The photo that stands for the gallery on cards and in share images, or null. */
export function galleryCover(
  items: readonly GalleryItem[] | undefined,
): { mediaId: string; alt?: string } | null {
  const item = items?.[coverIndex(items)]
  if (item?.kind === 'image') return { mediaId: item.mediaId, alt: item.alt }
  if (item?.kind === 'video' && item.poster) return item.poster
  return null
}
