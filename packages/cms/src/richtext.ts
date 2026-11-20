import { z } from 'zod'

/**
 * Rich text is stored as a small tree, not HTML, so the Worker never has to sanitize
 * markup: Zod checks it on save and `richTextToHtml` escapes it on the way out.
 * Marks are `bold`, `italic` and the extra ones a field declares, e.g. `muted`.
 */

export const BUILTIN_MARKS = ['bold', 'italic'] as const

/** Links can go to web pages, email addresses and phone numbers. */
export const safeHref = z.string().regex(/^(https?:\/\/|mailto:|tel:)\S+$/)

export interface RichTextInline {
  /** A newline is a line break within the block. */
  text: string
  marks?: string[]
  href?: string
}
export type RichTextBlock =
  | { type: 'p' | 'h2' | 'h3'; children: RichTextInline[] }
  | { type: 'ul' | 'ol'; items: RichTextInline[][] }
export type RichTextValue = RichTextBlock[]

const hasWords = (value: RichTextValue) =>
  value.some((b) => ('items' in b ? b.items.flat() : b.children).some((i) => i.text.trim()))

/** Zod schema for a rich text value that may use the given site marks. */
export function richTextSchema(siteMarks: readonly string[], required: boolean) {
  const mark = z.enum([...BUILTIN_MARKS, ...siteMarks] as [string, ...string[]])
  const inline = z.object({
    text: z.string(),
    marks: z.array(mark).optional(),
    href: safeHref.optional(),
  })
  const block = z.discriminatedUnion('type', [
    z.object({ type: z.enum(['p', 'h2', 'h3']), children: z.array(inline) }),
    z.object({ type: z.enum(['ul', 'ol']), items: z.array(z.array(inline)) }),
  ])
  const value = z.array(block) as z.ZodType<RichTextValue>
  return required ? value.refine(hasWords, { message: 'Empty' }) : value
}

// ---------- to HTML ----------

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Escaped HTML for a rich text value. `classes` maps each site mark to its class names.
 * With `editor: true` every site mark also gets `data-mark`, so Vefstjórn can read it back.
 */
export function richTextToHtml(
  value: RichTextValue,
  classes: Readonly<Record<string, string>> = {},
  options: { editor?: boolean } = {},
): string {
  const inline = (i: RichTextInline) => {
    const marks = i.marks ?? []
    let html = escape(i.text).replace(/\n/g, '<br>')
    for (const m of marks) {
      if ((BUILTIN_MARKS as readonly string[]).includes(m)) continue
      const data = options.editor ? ` data-mark="${escape(m)}"` : ''
      const cls = classes[m] ? ` class="${escape(classes[m])}"` : ''
      html = `<span${data}${cls}>${html}</span>`
    }
    if (marks.includes('italic')) html = `<em>${html}</em>`
    if (marks.includes('bold')) html = `<strong>${html}</strong>`
    if (i.href) html = `<a href="${escape(i.href)}">${html}</a>`
    return html
  }
  const inlines = (list: RichTextInline[]) => list.map(inline).join('')
  return value
    .map((b) =>
      'items' in b
        ? `<${b.type}>${b.items.map((li) => `<li>${inlines(li)}</li>`).join('')}</${b.type}>`
        : `<${b.type}>${inlines(b.children)}</${b.type}>`,
    )
    .join('')
}

// ---------- from the editor's DOM ----------

/** The part of a browser DOM node the parser reads; real `Node`s fit. */
export interface DomNode {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<DomNode>
  getAttribute?: (name: string) => string | null
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])
const HEADINGS: Record<string, 'h2' | 'h3'> = {
  H1: 'h2',
  H2: 'h2',
  H3: 'h3',
  H4: 'h3',
  H5: 'h3',
  H6: 'h3',
}
const CONTAINERS = new Set(['DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'BODY'])
const LISTS = new Set(['UL', 'OL'])

const children = (node: DomNode) => Array.from(node.childNodes)

/**
 * Reads the contenteditable editor back into a rich text value. Anything it doesn't know
 * (scripts, styles, unknown marks, unsafe links) is dropped; loose text becomes paragraphs.
 */
export function richTextFromDom(root: DomNode, siteMarks: readonly string[]): RichTextValue {
  const order = [...BUILTIN_MARKS, ...siteMarks]

  function collect(node: DomNode, marks: ReadonlySet<string>, href: string | undefined) {
    const out: RichTextInline[] = []
    const walk = (n: DomNode, m: ReadonlySet<string>, h: string | undefined) => {
      const isBreak = n.nodeType === 1 && n.nodeName === 'BR'
      if (n.nodeType === 3 || isBreak) {
        const text = isBreak ? '\n' : (n.textContent ?? '').replace(/\u00a0/g, ' ')
        if (!text) return
        const sorted = order.filter((x) => m.has(x))
        out.push({ text, ...(sorted.length ? { marks: sorted } : {}), ...(h ? { href: h } : {}) })
        return
      }
      if (n.nodeType !== 1 || SKIP.has(n.nodeName)) return
      const next = new Set(m)
      let link = h
      if (n.nodeName === 'B' || n.nodeName === 'STRONG') next.add('bold')
      if (n.nodeName === 'I' || n.nodeName === 'EM') next.add('italic')
      const mark = n.getAttribute?.('data-mark')
      if (mark && siteMarks.includes(mark)) next.add(mark)
      if (n.nodeName === 'A') {
        const target = n.getAttribute?.('href') ?? ''
        if (safeHref.safeParse(target).success) link = target
      }
      for (const c of children(n)) walk(c, next, link)
    }
    walk(node, marks, href)
    const merged = merge(out)
    // Browsers end a line with a <br> that isn't a line break of its own.
    const last = merged.at(-1)
    if (last) last.text = last.text.replace(/\n+$/, '')
    return merged.filter((i) => i.text)
  }

  const blocks: RichTextValue = []
  let loose: DomNode[] = []
  const flush = () => {
    if (loose.length === 0) return
    const parts = loose.flatMap((n) => collect(n, new Set(), undefined))
    loose = []
    const merged = merge(parts)
    if (merged.some((i) => i.text.trim())) blocks.push({ type: 'p', children: merged })
  }

  const walkBlocks = (parent: DomNode) => {
    for (const node of children(parent)) {
      const name = node.nodeType === 1 ? node.nodeName : ''
      if (SKIP.has(name)) continue
      if (CONTAINERS.has(name)) {
        flush()
        walkBlocks(node)
        flush()
      } else if (name === 'P' || name in HEADINGS) {
        flush()
        const inl = collect(node, new Set(), undefined)
        if (inl.some((i) => i.text.trim())) {
          blocks.push({ type: HEADINGS[name] ?? 'p', children: inl })
        }
      } else if (LISTS.has(name)) {
        flush()
        const items = children(node)
          .filter((li) => li.nodeType === 1 && li.nodeName === 'LI')
          .map((li) => collect(li, new Set(), undefined))
          .filter((inl) => inl.some((i) => i.text.trim()))
        if (items.length) blocks.push({ type: name === 'OL' ? 'ol' : 'ul', items })
      } else {
        loose.push(node)
      }
    }
  }
  walkBlocks(root)
  flush()
  return blocks
}

/** Joins neighbouring pieces with the same marks and link. */
function merge(list: RichTextInline[]): RichTextInline[] {
  const out: RichTextInline[] = []
  for (const item of list) {
    const last = out.at(-1)
    if (
      last &&
      last.href === item.href &&
      (last.marks ?? []).join() === (item.marks ?? []).join()
    ) {
      last.text += item.text
    } else out.push({ ...item })
  }
  return out
}
