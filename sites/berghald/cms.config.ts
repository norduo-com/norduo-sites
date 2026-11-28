import {
  block,
  defineCms,
  email,
  gallery,
  group,
  image,
  monthRange,
  multiSelect,
  relation,
  repeater,
  richText,
  select,
  seo,
  slug,
  tel,
  text,
  toggle,
  url,
  year,
} from '@norduo/cms'

import { BLOCK_ICONS, homeProjectWarnings, QUESTION_SETS } from './app/content'
import { seasonBadges, seasonNotice, SEASONS } from './app/seasons'

/** A page's header: `title` names it in the menu and is the SEO title's fallback. */
const header = () => ({
  title: text({ required: true, i18n: true, max: 40 }),
  eyebrow: text({ i18n: true }),
  heading: text({ i18n: true }),
  lead: text({ i18n: true, multiline: true, max: 300 }),
})

/** A link styled as a button: its text, and a path on the site ("/verkefni") or a full URL. */
const buttonFields = () => ({
  label: text({ i18n: true, max: 40 }),
  link: text(),
})
const button = () => group(buttonFields())

/** A step or value: an icon from the fixed set, a title and a short text. */
const iconItems = () =>
  repeater({
    icon: select(BLOCK_ICONS),
    title: text({ required: true, i18n: true }),
    text: text({ i18n: true, multiline: true }),
  })

/** Rich text with Berghald's grey mark ("Grátt"), used for the second half of a heading. */
const formatted = () => richText({ i18n: true, marks: { muted: 'text-muted' } })

/** The eyebrow and heading most blocks start with. */
const intro = () => ({
  eyebrow: text({ i18n: true }),
  heading: text({ i18n: true }),
})

/** Every block a page may hold, except the lists that belong to one page. */
const COMMON_BLOCKS = [
  'intro',
  'servicesCarousel',
  'feature',
  'recentProjects',
  'steps',
  'reviews',
  'quoteForm',
  'story',
  'values',
  'team',
  'equipment',
  'nextSteps',
  'text',
  'cookieTable',
] as const

/**
 * A page with the shared header and SEO, at `is` in Icelandic and `/en` + `en` in English.
 * Both are left out for the 404 page.
 */
const page = <const B extends readonly string[]>(
  route: { is: string; en: string } | undefined,
  blocks: B,
  extra: { note?: boolean } = {},
) => ({
  ...(route === undefined ? {} : { route: route.is, localeRoutes: { en: route.en } }),
  fields: header(),
  seo: seo({ titleFrom: 'title', descriptionFrom: 'lead' }),
  blocks,
  ...extra,
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
  // Told to the translation model; not shown anywhere.
  translation: {
    about:
      'Berghald, an Icelandic landscaping company (gardens, paving, stone walls, a crane truck)',
    glossary: {
      hellulögn: 'paving',
      hleðsla: 'stone walling',
      grjóthleðsla: 'stone wall',
      kranabíll: 'crane truck',
      þökulögn: 'turfing',
      lóðafrágangur: 'landscaping',
      snjómokstur: 'snow clearing',
    },
  },
  admin: {
    title: 'Vefstjórn',
    logo: '/logo_w.png',
    menu: ['projects', 'media', 'services', 'team', 'equipment', 'pages', 'settings'],
    shortcuts: [
      { name: 'newProject', to: 'projects/_new' },
      { name: 'media', to: 'media' },
      { name: 'services', to: 'services' },
    ],
  },
  collections: {
    projects: {
      titleField: 'title',
      sortable: true,
      drafts: true,
      layout: 'table',
      warnings: homeProjectWarnings,
      fields: {
        title: text({ required: true, i18n: true, max: 60 }),
        summary: text({ i18n: true, max: 160, multiline: true }),
        body: richText({ i18n: true }),
        services: relation('services', { many: true }),
        photos: gallery(),
        workPeriod: monthRange(),
        year: year(),
        showOnHome: toggle(),
        slug: slug({ from: 'title' }),
        seo: seo({ titleFrom: 'title', descriptionFrom: 'summary' }),
      },
    },
    services: {
      titleField: 'name',
      sortable: true,
      drafts: true,
      list: { notice: seasonNotice, badge: seasonBadges },
      fields: {
        name: text({ required: true, i18n: true, max: 40 }),
        homeText: text({ i18n: true, max: 90, multiline: true }),
        description: text({ i18n: true, max: 300, multiline: true }),
        items: repeater({ item: text({ required: true, i18n: true }) }),
        seasons: multiSelect(SEASONS, { min: 1 }),
        image: image(),
        homeImage: image(),
        dark: toggle(),
        showOnHome: toggle(),
        showProjects: toggle(),
        questions: select(QUESTION_SETS),
      },
    },
    team: {
      titleField: 'name',
      sortable: true,
      drafts: true,
      fields: {
        name: text({ required: true }),
        role: text({ i18n: true }),
        phone: tel(),
        showPhone: toggle(),
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
      note: true,
      fields: {
        company: text({ required: true }),
        kennitala: text(),
        phone: tel({ required: true }),
        email: email({ required: true }),
        contactName: text(),
        // Each is hidden on the site while empty.
        social: group({
          facebook: url(),
          instagram: url(),
          tiktok: url(),
          youtube: url(),
          linkedin: url(),
          x: url(),
          snapchat: url(),
          pinterest: url(),
        }),
        enquiriesTo: repeater({ email: email({ required: true }) }),
        responseTime: text({ i18n: true }),
      },
    },
    footer: {
      showUnder: 'pages',
      fields: {
        text: text({ i18n: true, multiline: true }),
        cta: group({
          eyebrow: text({ i18n: true }),
          heading: text({ i18n: true }),
          lead: text({ i18n: true, multiline: true }),
          button: text({ i18n: true }),
        }),
      },
    },
  },
  blocks: {
    intro: block({
      eyebrow: text({ i18n: true }),
      body: formatted(),
      button: button(),
    }),
    servicesCarousel: block({ ...intro(), buttonText: text({ i18n: true, max: 40 }) }),
    feature: block({
      ...intro(),
      text: text({ i18n: true, multiline: true }),
      items: repeater({ item: text({ required: true, i18n: true }) }),
      image: image(),
      dark: toggle(),
      buttons: repeater(buttonFields()),
    }),
    recentProjects: block({ ...intro(), buttonText: text({ i18n: true, max: 40 }) }),
    steps: block({
      ...intro(),
      steps: iconItems(),
    }),
    reviews: block({
      ...intro(),
      items: repeater({
        quote: text({ required: true, i18n: true, multiline: true }),
        name: text({ required: true }),
        place: text(),
      }),
    }),
    quoteForm: block({ ...intro(), lead: text({ i18n: true, multiline: true }) }),
    story: block({
      image1: image(),
      image2: image(),
      image3: image(),
      ...intro(),
      lead: text({ i18n: true, multiline: true }),
      text: text({ i18n: true, multiline: true }),
      button: button(),
    }),
    values: block({
      ...intro(),
      items: iconItems(),
    }),
    team: block({ ...intro(), lead: text({ i18n: true, multiline: true }) }),
    equipment: block({ ...intro(), lead: text({ i18n: true, multiline: true }) }),
    serviceList: block({}),
    projectList: block({}),
    nextSteps: block({
      ...intro(),
      steps: repeater({
        title: text({ required: true, i18n: true }),
        text: text({ i18n: true, multiline: true }),
      }),
    }),
    text: block({
      heading: text({ i18n: true }),
      body: formatted(),
    }),
    // The rows are written in the site's code, next to the cookies they describe.
    cookieTable: block({ heading: text({ i18n: true }) }),
  },
  pages: {
    home: {
      ...page({ is: '/', en: '/' }, COMMON_BLOCKS),
      fields: {
        ...header(),
        // Under the hero's heading: "Við sjáum um" and then each of the words in turn.
        wordsLead: text({ i18n: true, max: 40 }),
        words: repeater({ word: text({ required: true, i18n: true, max: 30 }) }),
      },
    },
    services: page({ is: '/thjonusta', en: '/services' }, [...COMMON_BLOCKS, 'serviceList']),
    projects: page({ is: '/verkefni', en: '/projects' }, [...COMMON_BLOCKS, 'projectList']),
    about: page({ is: '/um-okkur', en: '/about' }, COMMON_BLOCKS),
    thankYou: page({ is: '/takk-fyrir', en: '/thank-you' }, COMMON_BLOCKS),
    privacy: page({ is: '/personuvernd', en: '/privacy' }, COMMON_BLOCKS),
    cookies: page({ is: '/vafrakokur', en: '/cookies' }, COMMON_BLOCKS, { note: true }),
    notFound: page(undefined, COMMON_BLOCKS),
  },
})
