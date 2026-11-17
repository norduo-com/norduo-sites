import {
  block,
  blocks,
  defineCms,
  gallery,
  image,
  relation,
  repeater,
  richText,
  text,
  toggle,
} from '@norduo/cms'

/**
 * Berghald's content model. Vefstjórn builds its screens from this file;
 * the site's own components decide how each block looks.
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
      label: 'Verkefni',
      titleField: 'title',
      sortable: true,
      fields: {
        title: text({ label: 'Heiti', required: true, i18n: true, max: 80 }),
        summary: text({ label: 'Stutt lýsing', i18n: true, max: 200, multiline: true }),
        body: richText({ label: 'Texti', i18n: true }),
        service: relation('services', { label: 'Þjónusta' }),
        photos: gallery({ label: 'Myndir og myndbönd' }),
        year: text({ label: 'Ár' }),
        showOnHome: toggle({ label: 'Sýna á forsíðu' }),
      },
    },
    services: {
      label: 'Þjónusta',
      titleField: 'name',
      sortable: true,
      fields: {
        name: text({ label: 'Heiti', required: true, i18n: true }),
        summary: text({ label: 'Stutt lýsing', i18n: true, max: 160 }),
        body: richText({ label: 'Lengri texti', i18n: true }),
        image: image({ label: 'Mynd' }),
        items: repeater({ item: text({ required: true, i18n: true }) }, { label: 'Atriði' }),
      },
    },
    team: {
      label: 'Teymi',
      titleField: 'name',
      sortable: true,
      fields: {
        name: text({ label: 'Nafn', required: true }),
        role: text({ label: 'Hlutverk', i18n: true }),
        phone: text({ label: 'Símanúmer' }),
        photo: image({ label: 'Mynd' }),
      },
    },
    equipment: {
      label: 'Tæki',
      titleField: 'name',
      sortable: true,
      fields: {
        name: text({ label: 'Heiti', required: true, i18n: true }),
        description: text({ label: 'Lýsing', i18n: true, multiline: true }),
        photo: image({ label: 'Mynd' }),
      },
    },
    pages: {
      label: 'Síður og textar',
      titleField: 'title',
      fields: {
        title: text({ label: 'Heiti', required: true, i18n: true }),
        seoTitle: text({ label: 'Titill fyrir leitarvélar', i18n: true, max: 60 }),
        seoDescription: text({ label: 'Lýsing fyrir leitarvélar', i18n: true, max: 160 }),
        sections: blocks({
          hero: block('Hetja', {
            eyebrow: text({ i18n: true }),
            heading: text({ required: true, i18n: true }),
            intro: richText({ i18n: true }),
          }),
          services: block('Þjónustuhringekja', { heading: text({ i18n: true }) }),
          recentProjects: block('Nýleg verkefni', { heading: text({ i18n: true }) }),
          howWeWork: block('Svona vinnum við', {
            steps: repeater({
              title: text({ required: true, i18n: true }),
              text: text({ i18n: true }),
            }),
          }),
          testimonials: block('Umsagnir', {
            items: repeater({ quote: text({ required: true, i18n: true }), name: text() }),
          }),
          quoteForm: block('Tilboðsform', {
            heading: text({ i18n: true }),
            intro: text({ i18n: true }),
          }),
        }),
      },
    },
  },
  singletons: {
    settings: {
      label: 'Stillingar',
      fields: {
        company: text({ label: 'Fyrirtæki', required: true }),
        kennitala: text({ label: 'Kennitala' }),
        phone: text({ label: 'Sími', required: true }),
        email: text({ label: 'Netfang', required: true }),
        enquiriesTo: text({
          label: 'Senda fyrirspurnir á',
          help: 'Fleiri netföng aðskilin með kommu.',
        }),
        responseTime: text({ label: 'Svartími', i18n: true }),
      },
    },
  },
})
