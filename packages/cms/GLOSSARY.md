# Vefstjórn

The shared CMS. A site describes its content in a config, and Vefstjórn builds its editing screens from it without knowing anything about the site.

## Language

**Collection**:
A kind of content an editor can create many of, shown as a list (e.g. a site's projects or team members).
_Avoid_: Content type, model, table

**Singleton**:
A kind of content that exists exactly once per site, such as its settings.
_Avoid_: Global, single

**Page** (UI: _Síða_, listed under _Síður og textar_):
One of a site's fixed set of public pages. It has a header, SEO fields and an ordered list of blocks. Editors fill and arrange pages but cannot create or delete them.
_Avoid_: Route, screen

**Block** (UI: _Hluti_, listed under _Efni síðunnar_):
A section of a page that an editor can add, remove or move, chosen from the block types that page allows. The site decides how each block type looks.
_Avoid_: Component, widget, module

**Config hook**:
A pure function or flag in a site's config that adds to a generic screen: a list's notice and badges, a collection's warnings, a note card. It returns label keys, never wording, and never blocks a save.
_Avoid_: Plugin, slot, extension

**Draft** (UI: _Drög_):
A document in a collection that is saved but not shown on the public site. Only collections have drafts; a singleton goes live when saved.
_Avoid_: Unpublished, hidden

**Published** (UI: _Birt_):
A document in a collection that the public site shows.
_Avoid_: Live, active

**Media library** (UI: _Myndasafn_):
Every image and video uploaded to a site, in one place, with where each is used. An image filling a single image field can't be deleted until it's replaced there; one in a gallery is removed from it.
_Avoid_: Assets, uploads, gallery

**Master image**:
The one stored copy of an uploaded image: shrunk, cleaned of location and camera data, and the source of every size the site shows. The photo as it came off the phone is not kept.
_Avoid_: Original, source file

**Overview** (UI: _Yfirlit_):
Vefstjórn's start screen: recently edited documents, published and draft counts, and the site's shortcuts.
_Avoid_: Dashboard, home

**Subscription** (UI: _Áskrift_):
A site's paid plan with Norduo, its billing history and receipts. Every site has one.
_Avoid_: Billing, plan, account

**Preview** (UI: _Forskoðun_, button _Forskoða_):
A draft shown on its real public page, only to whoever holds a short-lived preview link for that one document. Everything else on the page shows published content. Only drafts can be previewed.
_Avoid_: Staging, test page

**Enquiry** (UI: _Fyrirspurn_):
A message a visitor sends through a site's quote form: their contact details, answers and any photos. It is kept for a fixed time, longer if it becomes a job.
_Avoid_: Lead, message, submission, ticket

**Job** (UI: _Verk_, link _Merkja sem verk_):
An enquiry the site owner has marked as having led to work. Marking it lengthens how long it is kept.
_Avoid_: Order, conversion, won

**Machine translation** (UI: _Óyfirfarið_ until reviewed):
An English text the CMS wrote from the Icelandic after a save. It is flagged Óyfirfarið in Vefstjórn until someone edits or approves it (_Samþykkja_), and shown on the public site meanwhile.
_Avoid_: Auto-translate, draft translation
