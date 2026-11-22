// ESLint rule: spacing and radius in site class names come from the tokens in
// docs/spacing-system.md (p-g, mt-s2, gap-grid, rounded-box, …), not arbitrary values.
// Small gaps inside a component (mt-2) have no token and stay allowed.

const SPACING =
  /^-?(p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|inset(-[xy])?|top|right|bottom|left)-\[/
const RADIUS = /^rounded(-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?(?:-(.+))?$/
const RADIUS_TOKENS = new Set(['box', 'card', 'img', 'full', 'none'])

/** The utility itself, without variants like `md:` or `hover:` and a leading `!`. */
const utility = (name) => name.slice(name.lastIndexOf(':') + 1).replace(/^!/, '')

function problem(name) {
  const u = utility(name)
  if (SPACING.test(u)) return 'arbitrary'
  const radius = RADIUS.exec(u)
  if (radius && !RADIUS_TOKENS.has(radius[2] ?? '')) return 'radius'
  return null
}

/** @type {import('eslint').Rule.RuleModule} */
export const spacingTokens = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use the spacing and radius tokens in class names' },
    messages: {
      arbitrary:
        '"{{name}}": use a spacing token (docs/spacing-system.md), not an arbitrary value.',
      radius: '"{{name}}": use rounded-box, rounded-card or rounded-img (docs/spacing-system.md).',
    },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      for (const name of text.split(/\s+/).filter(Boolean)) {
        const messageId = problem(name)
        if (messageId) context.report({ node, messageId, data: { name } })
      }
    }
    const visit = (node) => {
      if (!node) return
      if (node.type === 'Literal' && typeof node.value === 'string') check(node, node.value)
      else if (node.type === 'TemplateLiteral')
        for (const q of node.quasis) check(q, q.value.cooked ?? '')
      else if (node.type === 'JSXExpressionContainer') visit(node.expression)
    }
    return {
      JSXAttribute(node) {
        if (node.name.name === 'className') visit(node.value)
      },
    }
  },
}

export default { rules: { 'spacing-tokens': spacingTokens } }
