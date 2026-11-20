# Spacing system

These tokens come from the Berghald prototype and are implemented as Tailwind theme variables in `packages/ui/src/tokens.css`. The Tailwind class is the token name, for example `p-g`, `px-in`, `py-s`, `mt-s2` or `rounded-box`.

| Token          | Value                    | Use                                                                                                                                               |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `g`            | clamp(16px, 3vw, 40px)   | Outer gutter. Every box, card grid and heading starts here (40 / 23 / 16 px at 1440 / 768 / 390).                                                 |
| `in`           | clamp(20px, 3.6vw, 56px) | Inner padding of every big box: hero, page header, crane box, contact, CTA, tools, footer. Text inside boxes therefore always starts at `g + in`. |
| `s`            | clamp(64px, 9vw, 128px)  | Between sections, and before the CTA and contact boxes.                                                                                           |
| `s2`           | clamp(40px, 5vw, 72px)   | Page header → first content, between sub-blocks (project media → text → prev/next), and above the footer.                                         |
| `cp`           | 16px                     | Padding of image cards (services, projects, team, tools, service rows).                                                                           |
| `tp`           | 28px (22px mobile)       | Padding of text cards (reviews, values, facts, form, cookie bar).                                                                                 |
| `grid`         | 16px                     | Gap in every card grid.                                                                                                                           |
| `rounded-box`  | 36px (28px mobile)       | Radius of big boxes.                                                                                                                              |
| `rounded-card` | 28px (24px mobile)       | Radius of cards and standalone images.                                                                                                            |
| `rounded-img`  | 18px                     | Radius of images nested inside cards.                                                                                                             |
