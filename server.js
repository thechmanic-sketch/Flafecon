/**
 * Flafecon — backend API
 * Express + OpenAI. Implements the /api/generate contract the frontend calls
 * when CONFIG.API_MODE = 'backend'.
 *
 *   POST /api/generate   { engine: string, prompt: string }  ->  { text: string }
 *
 * Engines: website | research | business | brand | content | image
 * Run:  npm install && npm run dev   (needs OPENAI_API_KEY in .env)
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const { toFile } = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // serves the frontend (index.html)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---- governing continuity rules, prepended to every engine's instructions ----
   Keeps the model treating each chat as one ongoing piece of work instead of
   restarting from scratch on every message: default to modifying whatever was
   already being built, change only what's asked, stay consistent, and don't
   pepper the user with needless clarifying questions. */
const CONTINUITY_RULES =
`You are working inside one continuous piece of work with this user, not answering isolated one-off prompts.
- Default to CONTINUING and MODIFYING what's already been discussed in this conversation. Only treat a message as a brand-new, unrelated request if the user clearly signals that ("start over", "a completely different one", "forget that", "something else entirely").
- When the user asks for a change ("make it darker", "shorter", "fix this", "use the second version"), change only what they asked for and preserve everything else about the existing work — its structure, style, naming, and details.
- Stay consistent with the tone, style, terminology, and any names/brand details already established earlier in this conversation, unless told otherwise.
- Resolve pronouns and references ("it", "that", "the same", "again") against the most recent relevant output in the conversation history.
- Don't ask clarifying questions unless there are genuinely multiple, meaningfully different ways to interpret the request — otherwise just do the work.
- Don't narrate your reasoning process — produce the requested output directly.`;

/* ---- engine system prompts (single source of truth, server-side) ---- */
const SYSTEM_PROMPTS = {
  website:
`You are Flafecon's Website Builder. Produce a complete, production-ready, fully responsive static website.
Respond with ONLY valid JSON (no markdown fences, no commentary) in exactly this shape:
{"name":"kebab-case-name","title":"Human Title","html":"...","css":"...","js":"..."}
Rules: html is a full document linking styles.css and script.js; mobile-first; modern aesthetic; real semantic copy (no lorem ipsum); accessible.`,
  research:
`You are Flafecon's Research Engine. Produce a structured research brief in clean markdown with these exact headings: "## Executive Summary", "## Key Findings", "## Analysis", "## Opportunities", "## Risks", "## Recommendations". Be specific and decision-useful.`,
  business:
`You are Flafecon's Business Engine. Produce a business model in clean markdown with these exact headings: "## Business Concept", "## Target Market", "## Revenue Model", "## Pricing Strategy", "## Growth Strategy", "## Execution Roadmap". Use concrete numbers and next steps.`,
  brand:
`You are Flafecon's Brand Engine. Build a complete brand system in clean markdown with these exact headings: "## Brand Name", "## Positioning", "## Audience", "## Tone of Voice", "## Messaging", "## Visual Direction", "## Marketing Strategy". Give a concrete palette (hex), font pairing and logo concept.`,
  content:
`You are Flafecon's Content Engine. Generate polished, ready-to-publish content (blogs, social, ad copy, product descriptions, email campaigns) in clean markdown with a confident publishable voice.`
};

/* ---- server-side intent router (mirror of the client) ---- */
const KEYWORDS = {
  website: ['website','site','landing','webpage','web app','homepage','html','portfolio site','one pager'],
  research: ['research','analyze','analysis','study','market','investigate','report on','competitive','trends','findings'],
  business: ['business','startup','revenue','monetize','business model','pricing','go-to-market','gtm','roadmap','company'],
  brand: ['brand','branding','naming','logo','identity','positioning','tone of voice','tagline','slogan','rebrand'],
  content: ['blog','post','tweet','social','ad copy','email','caption','content','newsletter','product description','article'],
  image: ['image','picture','photo','illustration','draw','drawing','artwork','generate an image','icon of','poster','graphic of','render of']
};
const VALID_ENGINES = new Set([...Object.keys(SYSTEM_PROMPTS), 'image']);
function route(text) {
  const low = (text || '').toLowerCase();
  let best = 'content', score = 0;
  for (const k in KEYWORDS) {
    const hit = KEYWORDS[k].reduce((a, w) => a + (low.includes(w) ? (w.includes(' ') ? 2 : 1) : 0), 0);
    if (hit > score) { score = hit; best = k; }
  }
  return best;
}

/* ---- main endpoint ---- */
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, history, files, previousImage } = req.body || {};
    let { engine } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });
    if (!engine || engine === 'auto' || !VALID_ENGINES.has(engine)) engine = route(prompt);

    if (engine === 'image') {
      // Continuity: if there's a prior image in this chat and the client didn't
      // detect a "start a new one" phrase, EDIT that image instead of generating
      // an unrelated one from scratch — "make it blue" should modify, not restart.
      let image;
      if (previousImage && typeof previousImage === 'string' && previousImage.startsWith('data:image')) {
        const base64 = previousImage.split(',')[1];
        const buffer = Buffer.from(base64, 'base64');
        const file = await toFile(buffer, 'previous.png', { type: 'image/png' });
        image = await openai.images.edit({ model: 'gpt-image-1', image: file, prompt });
      } else {
        image = await openai.images.generate({ model: 'gpt-image-1', prompt, size: '1024x1024' });
      }
      const b64 = image?.data?.[0]?.b64_json;
      if (!b64) throw new Error('empty response from image model');
      return res.json({ engine, image: `data:image/png;base64,${b64}`, live: true });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-5.5';
    // Research & Business benefit from live web data (market info, current trends, pricing).
    // Website/Brand/Content are creative/structural — no search needed, kept faster & cheaper.
    const useSearch = engine === 'research' || engine === 'business';

    // Recent turns from the same chat thread, so follow-ups build on what was
    // already said instead of the model treating each prompt as a cold start.
    const turns = Array.isArray(history) ? history.slice(-8) : [];
    const input = turns
      .filter(t => t && typeof t.content === 'string')
      .map(t => ({ role: t.role === 'user' ? 'user' : 'assistant', content: t.content.slice(0, 4000) }));

    // Attachments: text files get inlined into the prompt text; images are
    // passed through as real multimodal input so the model can see them.
    const textFiles = Array.isArray(files) ? files.filter(f => f && f.kind === 'text' && typeof f.content === 'string') : [];
    const imageFiles = Array.isArray(files) ? files.filter(f => f && f.kind === 'image' && typeof f.dataUrl === 'string') : [];

    let promptText = prompt;
    if (textFiles.length) {
      promptText += '\n\n---\nAttached files:\n' +
        textFiles.slice(0, 5).map(f => `\n### ${f.name}\n${f.content.slice(0, 8000)}`).join('\n');
    }

    input.push({
      role: 'user',
      content: imageFiles.length
        ? [
            { type: 'input_text', text: promptText },
            ...imageFiles.slice(0, 4).map(f => ({ type: 'input_image', image_url: f.dataUrl }))
          ]
        : promptText
    });

    // Single, consistent code path (Responses API) for every engine — avoids mixing
    // the older Chat Completions endpoint with newer models that may not support it.
    const response = await openai.responses.create({
      model,
      instructions: `${CONTINUITY_RULES}\n\n${SYSTEM_PROMPTS[engine]}`,
      input,
      ...(useSearch ? { tools: [{ type: 'web_search' }] } : {})
    });

    const text = (response.output_text || '').trim();
    if (!text) throw new Error('empty response from model');
    res.json({ engine, text, live: useSearch });
  } catch (err) {
    // Log full detail server-side; surface a safe, useful message to the client for debugging.
    console.error('generate error:', err);
    res.status(500).json({
      error: 'generation failed',
      detail: err?.response?.data?.error?.message || err?.message || 'unknown error'
    });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, engines: [...VALID_ENGINES] }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Flafecon API running on http://localhost:${PORT}`));
}
module.exports = app; // exported for Vercel serverless
