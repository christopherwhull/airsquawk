const axios = require('axios');

/**
 * Gemini Agent wrapper
 *
 * This module provides a small pluggable adapter to call Google Gemini / Vertex AI
 * models if credentials/endpoint are provided via environment variables. If not
 * configured, it falls back to a lightweight local summarizer (first N sentences).
 *
 * Configuration (optional):
 * - GEMINI_API_URL: the full REST URL to post requests to (for example a Vertex AI
 *   predict endpoint). Example: https://us-central1-aiplatform.googleapis.com/v1/...
 * - GEMINI_API_KEY: bearer token or API key (if applicable). If using OAuth service
 *   account JSON, it's recommended to proxy requests with proper credentials instead.
 */

function extractSentences(text) {
    if (!text) return [];
    // naive sentence split by punctuation. Good enough as fallback.
    const parts = text.split(/(?<=[.!?])\s+/);
    return parts.filter(Boolean);
}

async function summarize(text, opts = {}) {
    const maxSentences = opts.maxSentences || 3;

    // If user configured a Gemini endpoint and key, try to call it.
    const url = process.env.GEMINI_API_URL;
    const key = process.env.GEMINI_API_KEY;
    if (url && key) {
        try {
            // This adapter assumes the endpoint accepts a JSON body { input: "..." }
            // and returns { summary: '...' } or a text field. Adjust as needed for your
            // actual Vertex/Gemini REST contract.
            const resp = await axios.post(url, { input: text, options: opts }, {
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                timeout: opts.timeout || 20000
            });

            if (resp && resp.data) {
                if (typeof resp.data === 'string') return resp.data;
                if (resp.data.summary) return resp.data.summary;
                if (resp.data.output_text) return resp.data.output_text;
                // If model returns completions array, join it
                if (Array.isArray(resp.data.outputs) && resp.data.outputs.length) {
                    return resp.data.outputs.map(o => o.text || o.output || '').join('\n');
                }
                return JSON.stringify(resp.data);
            }
        } catch (e) {
            // On error, log and fall back to local summarizer
            console.error('[GeminiAgent] Remote call failed:', e && e.message ? e.message : e);
        }
    }

    // Fallback local summarizer (extractive): first N sentences
    const sentences = extractSentences(text);
    if (sentences.length <= maxSentences) return sentences.join(' ');
    return sentences.slice(0, maxSentences).join(' ');
}

module.exports = { summarize };
