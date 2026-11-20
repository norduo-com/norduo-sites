import { describe, expect, it } from 'vitest'

import { richText, schemaOf } from './fields'
import { type DomNode, richTextFromDom, richTextToHtml } from './richtext'

const fields = { body: richText({ required: true, marks: { muted: 'text-muted' } }) }
const valid = (body: unknown) => schemaOf(fields).safeParse({ body }).success

describe('richText validation', () => {
  it('accepts paragraphs, headings and lists with bold, italic, links and site marks', () => {
    expect(
      valid([
        { type: 'h2', children: [{ text: 'Garðar' }] },
        {
          type: 'p',
          children: [
            { text: 'Við ' },
            { text: 'hönnum', marks: ['bold', 'muted'] },
            { text: ' garða', href: 'https://berghald.is' },
          ],
        },
        { type: 'ul', items: [[{ text: 'Hellur' }], [{ text: 'Torf', marks: ['italic'] }]] },
      ]),
    ).toBe(true)
  })

  it('rejects a mark the field does not declare', () => {
    expect(valid([{ type: 'p', children: [{ text: 'x', marks: ['red'] }] }])).toBe(false)
    const plain = { body: richText() }
    expect(
      schemaOf(plain).safeParse({
        body: [{ type: 'p', children: [{ text: 'x', marks: ['muted'] }] }],
      }).success,
    ).toBe(false)
  })

  it('rejects links that are not web, email or phone links', () => {
    expect(valid([{ type: 'p', children: [{ text: 'x', href: 'javascript:alert(1)' }] }])).toBe(
      false,
    )
    expect(valid([{ type: 'p', children: [{ text: 'x', href: 'mailto:a@b.is' }] }])).toBe(true)
  })

  it('treats a text with no words as empty when required', () => {
    expect(valid([])).toBe(false)
    expect(valid([{ type: 'p', children: [{ text: '  ' }] }])).toBe(false)
  })
})

describe('richTextToHtml', () => {
  it('escapes text and turns marks into elements and the site mark classes', () => {
    const html = richTextToHtml(
      [
        {
          type: 'p',
          children: [
            { text: '<b>1 & 2</b> ' },
            { text: 'grátt', marks: ['muted', 'bold'] },
            { text: 'hér', href: 'https://x.is/?a="1"' },
          ],
        },
        { type: 'ol', items: [[{ text: 'a' }], [{ text: 'b', marks: ['italic'] }]] },
      ],
      { muted: 'text-muted' },
    )
    expect(html).toBe(
      '<p>&lt;b&gt;1 &amp; 2&lt;/b&gt; <strong><span class="text-muted">grátt</span></strong>' +
        '<a href="https://x.is/?a=&quot;1&quot;">hér</a></p>' +
        '<ol><li>a</li><li><em>b</em></li></ol>',
    )
  })
})

// A stand-in for the browser's DOM, with only what the parser reads.
const txt = (text: string): DomNode => ({
  nodeType: 3,
  nodeName: '#text',
  textContent: text,
  childNodes: [],
})
const el = (name: string, attrs: Record<string, string>, ...children: DomNode[]): DomNode => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  textContent: children.map((c) => c.textContent).join(''),
  childNodes: children,
  getAttribute: (n) => attrs[n] ?? null,
})

describe('richTextFromDom', () => {
  const marks = ['muted']

  it('reads paragraphs, headings, lists, marks and links from the editor', () => {
    const root = el(
      'div',
      {},
      el('h2', {}, txt('Garðar')),
      el(
        'p',
        {},
        txt('Við '),
        el('b', {}, txt('hönn'), el('i', {}, txt('um'))),
        el('span', { 'data-mark': 'muted' }, txt(' grátt')),
        el('a', { href: 'https://berghald.is' }, txt(' hér')),
      ),
      el('ul', {}, el('li', {}, txt('Hellur')), el('li', {}, el('strong', {}, txt('Torf')))),
    )
    expect(richTextFromDom(root, marks)).toEqual([
      { type: 'h2', children: [{ text: 'Garðar' }] },
      {
        type: 'p',
        children: [
          { text: 'Við ' },
          { text: 'hönn', marks: ['bold'] },
          { text: 'um', marks: ['bold', 'italic'] },
          { text: ' grátt', marks: ['muted'] },
          { text: ' hér', href: 'https://berghald.is' },
        ],
      },
      { type: 'ul', items: [[{ text: 'Hellur' }], [{ text: 'Torf', marks: ['bold'] }]] },
    ])
  })

  it('drops scripts, unknown marks and unsafe links, and wraps loose text in paragraphs', () => {
    const root = el(
      'div',
      {},
      txt('Laus texti'),
      el('div', {}, el('span', { 'data-mark': 'red' }, txt('rautt'))),
      el(
        'p',
        {},
        el('script', {}, txt('alert(1)')),
        el('a', { href: 'javascript:x' }, txt('smelltu')),
      ),
    )
    expect(richTextFromDom(root, marks)).toEqual([
      { type: 'p', children: [{ text: 'Laus texti' }] },
      { type: 'p', children: [{ text: 'rautt' }] },
      { type: 'p', children: [{ text: 'smelltu' }] },
    ])
  })

  it('joins neighbouring text with the same marks and skips empty paragraphs', () => {
    const root = el(
      'div',
      {},
      el('p', {}, txt('a'), txt('b'), el('b', {})),
      el('p', {}, el('br', {})),
    )
    expect(richTextFromDom(root, marks)).toEqual([{ type: 'p', children: [{ text: 'ab' }] }])
  })

  it('keeps a line break inside a paragraph as a newline', () => {
    const root = el('div', {}, el('p', {}, txt('Berghald ehf.'), el('br', {}), txt('Hafnarfirði')))
    expect(richTextFromDom(root, marks)).toEqual([
      { type: 'p', children: [{ text: 'Berghald ehf.\nHafnarfirði' }] },
    ])
  })
})

describe('richTextToHtml line breaks', () => {
  it('writes a newline as <br>', () => {
    expect(richTextToHtml([{ type: 'p', children: [{ text: 'a\nb' }] }])).toBe('<p>a<br>b</p>')
  })
})
