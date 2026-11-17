/** @type {import("prettier").Config} */
export default {
  semi: false,
  singleQuote: true,
  printWidth: 100,
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './packages/ui/src/tokens.css',
}
