import { imageSrcSet, imageUrl, type MediaInfo } from '@norduo/cms'

/**
 * A photo from Vefstjórn at the four `/img` widths. The blurred preview shows until it loads,
 * and its width and height keep the layout from jumping.
 */
export function Photo({
  media,
  sizes,
  alt,
  className = '',
}: {
  media: MediaInfo
  /** Which width the photo takes on screen, e.g. "(min-width: 768px) 33vw, 100vw". */
  sizes: string
  alt?: string
  className?: string
}) {
  return (
    <img
      src={imageUrl(media.id, 960)}
      srcSet={imageSrcSet(media.id)}
      sizes={sizes}
      width={media.width || undefined}
      height={media.height || undefined}
      alt={alt ?? media.alt ?? ''}
      loading="lazy"
      decoding="async"
      className={`bg-cover bg-center ${className}`}
      style={media.lqip ? { backgroundImage: `url(${media.lqip})` } : undefined}
    />
  )
}
