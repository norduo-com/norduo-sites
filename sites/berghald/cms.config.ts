import {
  block,
  blocks,
  defineCms,
  email,
  gallery,
  image,
  monthRange,
  relation,
  repeater,
  richText,
  slug,
  tel,
  text,
  toggle,
  year,
} from '@norduo/cms'

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
    pages: {
      titleField: 'title',
      fields: {
        title: text({ required: true, i18n: true }),
        seoTitle: text({ i18n: true, max: 60 }),
        seoDescription: text({ i18n: true, max: 160 }),
        sections: blocks({
          hero: block({
            eyebrow: text({ i18n: true }),
            heading: text({ required: true, i18n: true }),
            intro: richText({ i18n: true }),
          }),
          services: block({ heading: text({ i18n: true }) }),
          recentProjects: block({ heading: text({ i18n: true }) }),
          howWeWork: block({
            steps: repeater({
              title: text({ required: true, i18n: true }),
              text: text({ i18n: true }),
            }),
          }),
          testimonials: block({
            items: repeater({ quote: text({ required: true, i18n: true }), name: text() }),
          }),
          quoteForm: block({
            heading: text({ i18n: true }),
            intro: text({ i18n: true }),
          }),
        }),
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
  },
})
