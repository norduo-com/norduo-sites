# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: multi-context

```
/
├── GLOSSARY-MAP.md              ← points to each context's glossary
├── docs/adr/                    ← system-wide decisions (hosting, monorepo, auth)
├── packages/cms/
│   ├── GLOSSARY.md              ← Vefstjórn: generic CMS terms (Collection, Block, Draft…)
│   └── docs/adr/                ← CMS-specific decisions
└── sites/berghald/
    ├── GLOSSARY.md              ← Berghald's business terms (Project, Service…)
    └── docs/adr/                ← Berghald-specific decisions
```

Future sites add their own `sites/<name>/GLOSSARY.md` and `sites/<name>/docs/adr/`, plus a line in `GLOSSARY-MAP.md`.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. Also check `packages/cms/docs/adr/` and `sites/<name>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## Rules for this repo

- **Language:** all domain docs, glossaries, ADRs and issues are written in English.
- **Icelandic labels:** each glossary term is in English (that's the canonical name in code and issues), and its entry records the Icelandic label used in the UI, e.g. **Project** (UI: _Verkefni_).
- **The CMS stays generic:** `packages/cms/GLOSSARY.md` never defines a site-specific term. If a CMS term needs a site's vocabulary to explain it, the term belongs in that site's glossary.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
