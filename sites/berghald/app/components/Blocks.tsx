import { type PageOf, richTextToHtml } from '@norduo/cms'

import type cms from '../../cms.config'

type StoredBlock = NonNullable<PageOf<typeof cms, 'home'>['blocks']>[number]

/** A page's blocks as they go to the browser: rich text is turned into HTML on the server. */
export type RenderedBlock =
  | { type: 'text'; heading?: string; html: string }
  | { type: 'quoteForm'; eyebrow?: string; heading?: string; lead?: string }

/** `marks` are the text block's rich text marks, passed in so the config stays out of the client. */
export function renderBlocks(
  blocks: readonly StoredBlock[] = [],
  marks: Readonly<Record<string, string>> = {},
): RenderedBlock[] {
  return blocks.map((block): RenderedBlock => {
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          heading: block.data.heading,
          html: richTextToHtml(block.data.body ?? [], marks),
        }
      case 'quoteForm':
        return { type: 'quoteForm', ...block.data }
    }
  })
}

/** The blocks of a page, in the order editors set in Vefstjórn. */
export function Blocks({ blocks }: { blocks: readonly RenderedBlock[] }) {
  return blocks.map((block, i) => {
    const key = `${block.type}-${String(i)}`
    switch (block.type) {
      case 'text':
        return (
          <section key={key} data-block="text" className="max-w-prose">
            {block.heading && <h2 className="text-3xl">{block.heading}</h2>}
            {block.html && (
              <div
                className="mt-4 gap-4 flex flex-col"
                // richTextToHtml escapes every value, so this is never raw editor markup.
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            )}
          </section>
        )
      case 'quoteForm':
        // The form itself comes with the quote form ticket; for now its own text.
        return (
          <section key={key} data-block="quoteForm" className="bg-white rounded-box p-in">
            {block.eyebrow && <p className="text-sm tracking-widest uppercase">{block.eyebrow}</p>}
            {block.heading && <h2 className="mt-4 text-3xl">{block.heading}</h2>}
            {block.lead && <p className="mt-4 max-w-prose">{block.lead}</p>}
          </section>
        )
    }
  })
}
