/* eslint-disable @typescript-eslint/no-deprecated --
 * execCommand is deprecated but is still the only built-in way to edit a contenteditable,
 * and every browser supports it. The stored value never depends on its markup: the DOM is
 * read back through `richTextFromDom`, which keeps only what a rich text value allows.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { markLabelKeys } from '../labels'
import { richTextFromDom, richTextToHtml, type RichTextValue, safeHref } from '../richtext'

const button =
  'rounded-md px-2 py-1 text-sm hover:bg-neutral-200 aria-pressed:bg-neutral-300 disabled:opacity-50'

/**
 * A contenteditable editor with a toolbar: paragraph, headings, lists, bold, italic, links
 * and the field's site marks. Pasted content comes in as plain text.
 */
export function RichTextInput({
  id,
  labelledBy,
  describedBy,
  invalid,
  owner,
  name,
  marks,
  value,
  onChange,
}: {
  id: string
  labelledBy: string
  describedBy: string | undefined
  invalid: boolean
  owner: string
  name: string
  marks: Record<string, string>
  value: unknown
  onChange: (value: unknown) => void
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const ref = useRef<HTMLDivElement>(null)
  const [initial] = useState(() => (Array.isArray(value) ? (value as RichTextValue) : []))
  const [link, setLink] = useState<{ range: Range; url: string } | null>(null)
  const siteMarks = Object.keys(marks)

  // The editor owns its DOM after the first render; re-rendering it would move the caret.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = richTextToHtml(initial, marks, { editor: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, [])

  const read = () => {
    if (!ref.current) return
    const next = richTextFromDom(ref.current, siteMarks)
    onChange(next.length ? next : undefined)
  }

  const selection = () => {
    const sel = window.getSelection()
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null
    return range && ref.current?.contains(range.commonAncestorContainer) ? range : null
  }

  const exec = (command: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(command, false, arg)
    read()
  }

  /** Wraps the selection in the mark, or unwraps it when the selection is already inside it. */
  const toggleMark = (mark: string) => {
    const range = selection()
    if (!range) return
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    const inside = start?.closest(`[data-mark="${CSS.escape(mark)}"]`)
    if (inside && ref.current?.contains(inside)) {
      inside.replaceWith(...Array.from(inside.childNodes))
    } else if (!range.collapsed && ref.current) {
      // Wrap each selected piece of text on its own, so a selection over several
      // paragraphs or list items keeps them apart.
      const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT)
      const pieces: Text[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n instanceof Text && range.intersectsNode(n)) pieces.push(n)
      }
      const { startContainer, startOffset, endContainer, endOffset } = range
      for (const piece of pieces) {
        let target = piece
        if (target === endContainer && endOffset < target.length) target.splitText(endOffset)
        if (target === startContainer && startOffset > 0) target = target.splitText(startOffset)
        if (!target.data) continue
        const span = document.createElement('span')
        span.dataset.mark = mark
        span.className = marks[mark] ?? ''
        target.replaceWith(span)
        span.appendChild(target)
      }
    }
    read()
  }

  const openLink = () => {
    const range = selection()
    if (range && !range.collapsed) setLink({ range: range.cloneRange(), url: 'https://' })
  }

  const applyLink = () => {
    if (!link) return
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(link.range)
    if (safeHref.safeParse(link.url.trim()).success) exec('createLink', link.url.trim())
    setLink(null)
  }

  /** Toolbar buttons: an execCommand, a site mark or the link form. */
  type Tool = { label: string } & (
    { command: string; arg?: string } | { mark: string } | { link: true }
  )
  const tools: Tool[] = [
    { label: t('richText.paragraph'), command: 'formatBlock', arg: '<p>' },
    { label: t('richText.h2'), command: 'formatBlock', arg: '<h2>' },
    { label: t('richText.h3'), command: 'formatBlock', arg: '<h3>' },
    { label: t('richText.ul'), command: 'insertUnorderedList' },
    { label: t('richText.ol'), command: 'insertOrderedList' },
    { label: t('richText.bold'), command: 'bold' },
    { label: t('richText.italic'), command: 'italic' },
    ...siteMarks.map((mark) => ({
      label: t(markLabelKeys(owner, name, mark), { ns: 'cms' }),
      mark,
    })),
    { label: t('richText.link'), link: true },
    { label: t('richText.unlink'), command: 'unlink' },
  ]
  const run = (tool: Tool) => {
    if ('command' in tool) exec(tool.command, tool.arg)
    else if ('mark' in tool) toggleMark(tool.mark)
    else openLink()
  }

  return (
    <div className="rounded-lg border-neutral-300 bg-white has-aria-invalid:border-red-600 border">
      <div
        role="toolbar"
        aria-label={t('richText.toolbar')}
        aria-controls={id}
        className="gap-1 border-neutral-200 p-1 flex flex-wrap border-b"
      >
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            className={button}
            // Keep the editor's selection when the button is pressed.
            onMouseDown={(e) => {
              e.preventDefault()
            }}
            onClick={() => {
              run(tool)
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>
      {link && (
        <div className="gap-2 border-neutral-200 p-2 flex flex-wrap items-center border-b">
          <label className="gap-2 flex items-center">
            {t('richText.linkUrl')}
            <input
              type="url"
              className="rounded-md border-neutral-300 px-2 py-1 border"
              value={link.url}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the Tengill button
              autoFocus
              onChange={(e) => {
                setLink({ ...link, url: e.target.value })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyLink()
                }
              }}
            />
          </label>
          <button type="button" className={button} onClick={applyLink}>
            {t('richText.applyLink')}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              setLink(null)
            }}
          >
            {t('actions.cancel')}
          </button>
        </div>
      )}
      <div
        ref={ref}
        id={id}
        role="textbox"
        tabIndex={0}
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        contentEditable
        suppressContentEditableWarning
        className="prose min-h-32 px-3 py-2 [&_h2]:text-xl [&_h3]:text-lg [&_ol]:pl-6 [&_ul]:pl-6 focus:outline-none [&_a]:underline [&_ol]:list-decimal [&_ul]:list-disc"
        onFocus={() => {
          document.execCommand('defaultParagraphSeparator', false, 'p')
        }}
        onInput={read}
        onPaste={(e) => {
          e.preventDefault()
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          read()
        }}
      />
    </div>
  )
}
