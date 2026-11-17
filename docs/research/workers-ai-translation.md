# Research: Workers AI translation, Icelandic to English

Ticket: #3. Question: can Workers AI translate Icelandic (is) to English (en) well enough to run automatically on save, inside the free daily allowance? The save must still succeed when translation fails.

Researched 2026-11-17 against Cloudflare's docs and the upstream model cards. Prices and model lists on Cloudflare change often, so re-check them before building.

## Short answer

- **Yes, it is feasible on the free allowance.** A typical save costs roughly 20 to 100 neurons. The free allowance is 10,000 neurons a day, so that is about 100 to 500 saves a day, far more than a single editor makes.
- **Use an instruction-tuned LLM, not the dedicated translation model.** Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`) is the main pick and Qwen3 (`@cf/qwen/qwen3-30b-a3b-fp8`) is the fallback. Keep `@cf/meta/m2m100-1.2b` as a last resort only. It supports Icelandic, but it is a small 2020 model that takes plain text only, so it will damage HTML.
- **Handle rich text in code.** Split the HTML into text segments, translate them, and put them back. The model should never be trusted to return the markup unchanged.
- **Treat failure as normal.** On Workers Free, an exhausted allowance returns HTTP 429 with code `3036` until 00:00 UTC. Save the Icelandic content first, and run translation as a separate best-effort step.
- **Quality is unverified.** No primary source publishes is→en scores for these models on Workers AI. A real test needs a Cloudflare account and API token, which this research did not have. Run the test described below before committing.

## 1. Which models can do is→en

### Dedicated translation models

The Workers AI catalog lists two models under the Translation task ([models][models]):

| Model | Icelandic? | Notes |
|---|---|---|
| `@cf/meta/m2m100-1.2b` | Yes. The upstream card lists "Icelandic (is)" among its 100 languages ([HF card][m2m-hf]). | Encoder-decoder model from 2020 ([paper][m2m-paper]). Input is `text`, `source_lang` (defaults to `en`) and `target_lang` ([CF card][m2m-cf]). There is no prompt and no way to give it a glossary or tone. Batch (async) is supported. The CF page mixes codes (`en`) and names (`english`) in its examples, so test which form works for `is`. |
| `@cf/ai4bharat/indictrans2-en-indic-1B` | No | English to Indic languages only. |

### General LLMs (translate by prompt)

| Model | Icelandic? | Source |
|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | Probably. Pre-trained on 140+ languages, with "out-of-the-box support for 35+ languages". The card does not say whether Icelandic is in the 35. | [Gemma 4 model card][gemma4] |
| `@cf/qwen/qwen3-30b-a3b-fp8` | Yes. Icelandic is in Qwen3's list of 119 languages. | [Qwen3 announcement][qwen3] |
| Llama 3.x (`llama-3.1-8b`, `llama-3.2-*`, `llama-3.3-70b`) | No. Officially supported languages are English, German, French, Italian, Portuguese, Hindi, Spanish and Thai. | [Llama 3.1 card][llama31] |
| `gpt-oss-20b` / `gpt-oss-120b`, `mistral-small-3.1-24b-instruct` | Not checked in depth. They are possible alternatives if the two above disappoint. | [models][models] |

The catalog shows no "Workers Paid only" badge on any of these ([models][models]). Error code `5035` ("Model requires Workers Paid plan") exists, though ([errors][errors]), so confirm the chosen model on a free account during the test.

## 2. Quality on short marketing copy

- **No primary source gives is→en quality numbers for these models as Workers AI serves them.** The Gemma 4 card has no text-translation benchmark, only speech translation ([gemma4][gemma4]). The M2M-100 card has no per-language scores ([HF card][m2m-hf]).
- Inference, not measured: Icelandic is a low-resource language, and M2M-100 1.2B is small and old, so expect literal output with grammar slips. Its translation also can't be guided. A modern 26B to 30B LLM given a system prompt (tone, a glossary of trade terms such as hellulögn, hleðsla, kranabíll, and "keep proper nouns") will usually read more naturally for marketing copy. It may also paraphrase or add text, so the prompt must say "translate only, no commentary".
- This fits the plan: every result is flagged "Óyfirfarið" (`needs_review`), so a person reviews it before it can be trusted.

## 3. Neuron cost per save and the free allowance

Free allowance: **10,000 neurons per day**, reset at 00:00 UTC. On Workers Free there is no overage billing: "further operations will fail with an error" ([pricing][pricing]).

Per-million-token rates ([pricing][pricing]):

| Model | Input neurons / M tokens | Output neurons / M tokens |
|---|---|---|
| `m2m100-1.2b` | 31,050 | 31,050 |
| `gemma-4-26b-a4b-it` | 9,091 | 27,273 |
| `qwen3-30b-a3b-fp8` | 4,625 | 30,475 |
| `llama-3.3-70b-instruct-fp8-fast` (for comparison) | 26,668 | 204,805 |

Estimate for a typical save. This is an assumption: about 400 words of Icelandic across all translatable fields of a page. Icelandic tokenises inefficiently, so take roughly 1,000 input tokens of content plus 300 tokens of system prompt, and about 700 output tokens of English.

| Model | Neurons per save | Saves per day within 10k |
|---|---|---|
| Gemma 4 26B | 1,300 × 9,091/M + 700 × 27,273/M ≈ **31** | ~320 |
| Qwen3 30B (thinking off) | 1,300 × 4,625/M + 700 × 30,475/M ≈ **27** | ~370 |
| M2M-100 1.2B | (1,000 + 700) × 31,050/M ≈ **53** | ~190 |

Qwen3 is a reasoning model. Turn thinking off (for example, `/no_think` in the prompt) or the hidden reasoning tokens will multiply the output cost. Even a large 2,000-word page costs only a few hundred neurons. One way to stay safe: translate only fields whose Icelandic text has changed, by storing a hash of the source next to each translation. Then re-saving a page doesn't spend neurons again.

## 4. Rich text (HTML)

`richText` is stored as a string (`packages/cms/src/fields.ts`), presumably HTML. M2M-100 takes plain text only and has no notion of markup ([CF card][m2m-cf]). LLMs usually keep tags, but nothing guarantees it. The recommended approach, which works with any model:

1. Parse the HTML on the server. Workers have `HTMLRewriter`, or a small parser can run over the editor's JSON if the editor stores JSON.
2. Pull out the translatable text one block at a time (`p`, `li`, `h2`…). Replace inline tags with numbered placeholders, for example `<b>` becomes `[1]…[/1]` and `<a href>` becomes `[2]…[/2]`, so word order can change across them. Never send attributes (`href`, `src`) to the model.
3. Send all segments of a save in **one** LLM call as a JSON array, using JSON mode or a strict "return an array of the same length" instruction. One call keeps request count and prompt overhead low.
4. Check the reply: the same number of segments, and every placeholder present exactly once. Rebuild the HTML from the original tree. If the check fails, fall back to translating per segment, and if that fails too, leave the field untranslated.

## 5. Rate limits

([limits][limits])

- Translation task (M2M-100): **720 requests/minute**.
- Text generation: **300 requests/minute** for models that don't require Workers Paid.

One editor saving pages will never come close to either. The daily neuron allowance is the real limit.

CPU: time spent waiting on `env.AI.run()` is I/O and does not count against the 10 ms CPU limit. HTML parsing and rebuilding does count, so keep it linear and small. A typical page is well under the limit.

## 6. When the allowance runs out

From [errors][errors]:

| Code | HTTP | Meaning |
|---|---|---|
| `3036` | 429 | "You have used up your daily free allocation of 10,000 neurons." Lasts until 00:00 UTC. |
| `3040` | 429 | "Capacity temporarily exceeded, please try again." This is temporary, so retry once with backoff. |
| `3007` / `3008` | 408 | Timeout / aborted |
| `5035` | 403 | Model requires Workers Paid |

`env.AI.run()` throws on these. Recommended save flow in the Hono API:

1. Validate the save and write it to D1, then respond. The Icelandic save never depends on AI.
2. Run translation afterwards, in `ctx.waitUntil()` or a follow-up request from the admin. Wrap it in try/catch. On success, write the English fields with `needs_review = 1` and the source hash.
3. On `3036`, record "translation pending" for the field and show it in the admin (for example "Þýðing bíður – dagskvóti búinn"). Retry on the next save, or have the nightly cron Worker retry after 00:00 UTC. On any other error, leave the English field as it was and show a retry button.

## 7. Empirical test (not done)

A real test needs a Cloudflare account ID and an API token with Workers AI permission. The REST endpoint is `POST /accounts/{id}/ai/run/@cf/...`. Local `wrangler dev` also runs AI bindings against the real remote service, so it needs a login as well. No credentials were used for this research.

To run the test: take about 10 real Berghald strings (headings, a service description, a rich-text paragraph with a link and bold text). Run each through Gemma 4, Qwen3 (no-think) and M2M-100 (`source_lang` as both `is` and `icelandic`). Compare the English side by side, and read the `usage` token counts in each response to confirm the neuron estimate. This should take about 30 minutes and well under 1,000 neurons.

## Sources

- `models`: <https://developers.cloudflare.com/workers-ai/models/>
- `m2m-cf`: <https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/>
- `m2m-hf`: <https://huggingface.co/facebook/m2m100_1.2B>
- `m2m-paper`: <https://arxiv.org/abs/2010.11125>
- `pricing`: <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- `limits`: <https://developers.cloudflare.com/workers-ai/platform/limits/>
- `errors`: <https://developers.cloudflare.com/workers-ai/platform/errors/>
- `gemma4`: <https://gemma.ai/models/gemma-4/model-card/>
- `qwen3`: <https://qwenlm.github.io/blog/qwen3/>
- `llama31`: <https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct>

[models]: https://developers.cloudflare.com/workers-ai/models/
[m2m-cf]: https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/
[m2m-hf]: https://huggingface.co/facebook/m2m100_1.2B
[m2m-paper]: https://arxiv.org/abs/2010.11125
[pricing]: https://developers.cloudflare.com/workers-ai/platform/pricing/
[limits]: https://developers.cloudflare.com/workers-ai/platform/limits/
[errors]: https://developers.cloudflare.com/workers-ai/platform/errors/
[gemma4]: https://gemma.ai/models/gemma-4/model-card/
[qwen3]: https://qwenlm.github.io/blog/qwen3/
[llama31]: https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct
