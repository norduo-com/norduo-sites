import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'

import { spacingTokens } from './spacing-tokens.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.afterAll = afterAll

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
})

const jsx = (className) => `const a = <div className=${className} />`

tester.run('spacing-tokens', spacingTokens, {
  valid: [
    jsx('"p-g md:px-in mt-s2 gap-grid rounded-box"'),
    jsx('"p-cp rounded-card"'),
    jsx('"rounded-img rounded-full md:rounded-none"'),
    // Small gaps inside a component have no token.
    jsx('"mt-2 mb-4 gap-2"'),
    jsx('{`p-tp ${x}`}'),
    jsx('"aspect-4/3 w-[120%]"'),
  ],
  invalid: [
    { code: jsx('"p-[12px]"'), errors: [{ messageId: 'arbitrary', data: { name: 'p-[12px]' } }] },
    { code: jsx('"md:-mt-[3rem]"'), errors: [{ messageId: 'arbitrary' }] },
    { code: jsx('"gap-x-[5px]"'), errors: [{ messageId: 'arbitrary' }] },
    { code: jsx('{`flex ${x} py-[2vw]`}'), errors: [{ messageId: 'arbitrary' }] },
    { code: jsx('"rounded-lg"'), errors: [{ messageId: 'radius', data: { name: 'rounded-lg' } }] },
    { code: jsx('"rounded"'), errors: [{ messageId: 'radius' }] },
    { code: jsx('"hover:rounded-t-xl"'), errors: [{ messageId: 'radius' }] },
    { code: jsx('"rounded-[10px]"'), errors: [{ messageId: 'radius' }] },
  ],
})
