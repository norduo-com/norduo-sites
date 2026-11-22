import {
  block,
  defineCms,
  email,
  gallery,
  group,
  image,
  monthRange,
  relation,
  repeater,
  richText,
  seo,
  slug,
  tel,
  text,
  toggle,
  year,
} from '@norduo/cms'

/** A page's header: `title` names it in the menu and is the SEO title's fallback. */
const header = () => ({
  title: text({ required: true, i18n: true, max: 40 }),
  eyebrow: text({ i18n: true }),
  heading: text({ i18n: true }),
  lead: text({ i18n: true, multiline: true, max: 300 }),
})

/** A page with the shared header and SEO; `route` is left out for the 404 page. */
const page = <const B extends readonly string[]>(route: string | undefined, blocks: B) => ({
  ...(route === undefined ? {} : { route }),
  fields: header(),
  seo: seo({ titleFrom: 'title', descriptionFrom: 'lead' }),
  blocks,
})

/**
 * Berghald's content model. Vefstjórn builds its screens from this file;
 * the site's own components decide how each block looks.
 * Labels live in `locales/is/cms.json`, keyed by config path.
 */
export default defineCms({
  site: {
    id: 'berghald',
    name: 'Berghald',
    url: 'https://berghald.is',
    locales: ['is', 'en'],
    defaultLocale: 'is',
  },
  admin: {
    title: 'Vefstjórn',
    logo: '/logo_w.png',
    menu: ['projects', 'media', 'services', 'team', 'equipment', 'pages', 'settings'],
  },
  collections: {
    projects: {
      titleField: 'title',
      sortable: true,
      fields: {
        title: text({ required: true, i18n: true, max: 80 }),
        summary: text({ i18n: true, max: 200, multiline: true }),
        body: richText({ i18n: true }),
        services: relation('services', { many: true }),
        photos: gallery(),
        workPeriod: monthRange(),
        year: year(),
        showOnHome: toggle(),
        slug: slug({ from: 'title' }),
      },
    },
    services: {
      titleField: 'name',
      sortable: true,
      fields: {
        name: text({ required: true, i18n: true }),
        summary: text({ i18n: true, max: 160 }),
        body: richText({ i18n: true }),
        image: image(),
        items: repeater({ item: text({ required: true, i18n: true }) }),
      },
    },
    team: {
      titleField: 'name',
      sortable: true,
      fields: {
        name: text({ required: true }),
        role: text({ i18n: true }),
        phone: tel(),
        photo: image(),
      },
    },
    equipment: {
      titleField: 'name',
      sortable: true,
      drafts: true,
      fields: {
        name: text({ required: true, i18n: true }),
        description: text({ i18n: true, max: 120, multiline: true }),
        photo: image(),
      },
    },
  },
  singletons: {
    settings: {
      fields: {
        company: text({ required: true }),
        kennitala: text(),
        phone: tel({ required: true }),
        email: email({ required: true }),
        enquiriesTo: text(),
        responseTime: text({ i18n: true }),
      },
    },
    footer: {
      showUnder: 'pages',
      fields: {
        text: text({ i18n: true, multiline: true }),
        cta: group({
          heading: text({ i18n: true }),
          button: text({ i18n: true }),
        }),
      },
    },
  },
  blocks: {
    text: block({
      heading: text({ i18n: true }),
      body: richText({ i18n: true }),
    }),
    quoteForm: block({
      eyebrow: text({ i18n: true }),
      heading: text({ i18n: true }),
      lead: text({ i18n: true, multiline: true }),
    }),
  },
  pages: {
    home: page('/', ['text', 'quoteForm']),
    services: page('/thjonusta', ['text']),
    projects: page('/verkefni', ['text']),
    about: page('/um-okkur', ['text']),
    thankYou: page('/takk-fyrir', ['text']),
    privacy: page('/personuvernd', ['text']),
    cookies: page('/vafrakokur', ['text']),
    notFound: page(undefined, ['text']),
  },
})
