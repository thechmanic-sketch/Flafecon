/**
 * Flafecon — backend API
 * Express + OpenAI. Implements the /api/generate contract the frontend calls
 * when CONFIG.API_MODE = 'backend'.
 *
 *   POST /api/generate   { engine: string, prompt: string }  ->  { text: string }
 *
 * Engines: website | research | business | brand | content
 * Run:  npm install && npm run dev   (needs OPENAI_API_KEY in .env)
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // serves the frontend (index.html)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  content: ['blog','post','tweet','social','ad copy','email','caption','content','newsletter','product description','article']
};
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
    const { prompt } = req.body || {};
    let { engine } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });
    if (!engine || engine === 'auto' || !SYSTEM_PROMPTS[engine]) engine = route(prompt);

    const model = process.env.OPENAI_MODEL || 'gpt-5.5';
    // Research & Business benefit from live web data (market info, current trends, pricing).
    // Website/Brand/Content are creative/structural — no search needed, kept faster & cheaper.
    const useSearch = engine === 'research' || engine === 'business';

    // Single, consistent code path (Responses API) for every engine — avoids mixing
    // the older Chat Completions endpoint with newer models that may not support it.
    const response = await openai.responses.create({
      model,
      instructions: SYSTEM_PROMPTS[engine],
      input: prompt,
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

app.get('/api/health', (_req, res) => res.json({ ok: true, engines: Object.keys(SYSTEM_PROMPTS) }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Flafecon API running on http://localhost:${PORT}`));
}
module.exports = app; // exported for Vercel serverless
