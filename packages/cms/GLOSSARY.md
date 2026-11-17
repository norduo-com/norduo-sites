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

**Block**:
A section of a page that an editor can add, remove or move, chosen from the block types that page allows. The site decides how each block type looks.
_Avoid_: Component, widget, module

**Draft** (UI: _Drög_):
A document in a collection that is saved but not shown on the public site. Only collections have drafts; a singleton goes live when saved.
_Avoid_: Unpublished, hidden

**Published** (UI: _Birt_):
A document in a collection that the public site shows.
_Avoid_: Live, active
