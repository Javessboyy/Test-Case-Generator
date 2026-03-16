import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

const PORT = 3001;
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-5.2';
const MIN_TEST_CASES = 35;
const MAX_EXPANSION_ATTEMPTS = 2;

function extractBalancedJsonArray(input) {
    const text = String(input || '');
    let inString = false;
    let escapeNext = false;
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (ch === '\\') {
            if (inString) escapeNext = true;
            continue;
        }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (ch === '[') {
            if (depth === 0) start = i;
            depth += 1;
            continue;
        }

        if (ch === ']') {
            if (depth > 0) depth -= 1;
            if (depth === 0 && start !== -1) {
                return text.slice(start, i + 1);
            }
        }
    }

    return '';
}

function tryParseJsonArray(rawText) {
    const text = String(rawText || '')
        .replace(/^```(?:json)?/gm, '')
        .replace(/```$/gm, '')
        .trim();

    const extracted = extractBalancedJsonArray(text);

    const candidates = [...new Set([
        text,
        extracted,
        text
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/,\s*([\]}])/g, '$1')
            .trim(),
        extracted
            ? extracted
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/,\s*([\]}])/g, '$1')
                .trim()
            : ''
    ].filter(Boolean))];

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) {
                return { parsed, normalized: JSON.stringify(parsed) };
            }
        } catch {
            // Try next candidate.
        }
    }

    return null;
}

function normalizeCase(tc) {
    const safe = tc && typeof tc === 'object' ? tc : {};
    const testSteps = Array.isArray(safe.test_steps) ? safe.test_steps.filter(Boolean).map((s) => String(s)) : [];
    const steps = Array.isArray(safe.steps) ? safe.steps.filter(Boolean).map((s) => String(s)) : [];
    const behaviour = String(safe.behaviour || 'positive').toLowerCase();

    return {
        title: String(safe.title || 'Untitled test case'),
        test_steps: testSteps.length ? testSteps : steps,
        expected_result: String(safe.expected_result || '-'),
        priority: String(safe.priority || 'Medium'),
        behaviour
    };
}

function mergeUniqueCases(existingCases, newCases) {
    const merged = [...existingCases];
    const seen = new Set(existingCases.map((tc) => `${String(tc.title).toLowerCase()}|${String(tc.behaviour || '').toLowerCase()}`));

    for (const tc of newCases) {
        const key = `${String(tc.title).toLowerCase()}|${String(tc.behaviour || '').toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(tc);
    }

    return merged;
}

async function callOpenRouter({ apiKey, model, prompt }) {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    const referer = process.env.OPENROUTER_REFERER;
    const title = process.env.OPENROUTER_TITLE;
    if (referer) headers['HTTP-Referer'] = referer;
    if (title) headers['X-OpenRouter-Title'] = title;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    const raw = await response.text();
    let data = null;

    if (raw) {
        try {
            data = JSON.parse(raw);
        } catch {
            data = null;
        }
    }

    return { response, raw, data };
}

async function repairJsonWithOpenRouter({ apiKey, model, invalidOutput }) {
    const repairPrompt = `You are a JSON repair engine. Convert the content below into a strict valid JSON array.

Rules:
- Return ONLY a JSON array.
- Do not add explanations or markdown.
- Keep original meaning and fields as much as possible.
- Ensure all strings are properly quoted and escaped.

Content to repair:
${String(invalidOutput || '').substring(0, 12000)}`;

    const { response, raw, data } = await callOpenRouter({
        apiKey,
        model,
        prompt: repairPrompt
    });

    if (!response.ok) {
        return {
            ok: false,
            reason: 'OpenRouter repair request failed',
            details: data || raw
        };
    }

    const repairedText = data?.choices?.[0]?.message?.content || '';

    const parsed = tryParseJsonArray(repairedText);

    if (!parsed) {
        return {
            ok: false,
            reason: 'Repair output is still not valid JSON array',
            details: repairedText.substring(0, 500)
        };
    }

    return { ok: true, parsed };
}

async function ensureMinimumCases({ apiKey, model, systemPrompt, pdfText, initialCases }) {
    let cases = [...initialCases];

    for (let attempt = 1; attempt <= MAX_EXPANSION_ATTEMPTS && cases.length < MIN_TEST_CASES; attempt++) {
        const remaining = MIN_TEST_CASES - cases.length;
        const expansionPrompt = `${systemPrompt}

Source documentation:
${pdfText}

Already generated test cases (do not repeat endpoint+title):
${JSON.stringify(cases).substring(0, 12000)}

Generate ${remaining + 8} additional UNIQUE test cases to reach at least ${MIN_TEST_CASES} total cases.
Return ONLY a JSON array.`;

        const { response, raw, data } = await callOpenRouter({
            apiKey,
            model,
            prompt: expansionPrompt
    });

        if (!response.ok) {
            console.error('OpenRouter expansion error:', data || raw);
            break;
        }

        const expandedText = data?.choices?.[0]?.message?.content || '';

        let expandedParsed = tryParseJsonArray(expandedText);

        if (!expandedParsed) {
            const repaired = await repairJsonWithOpenRouter({ apiKey, model, invalidOutput: expandedText });
            if (!repaired.ok) {
                console.error('Expansion parse/repair failed:', repaired.reason);
                continue;
            }
            expandedParsed = repaired.parsed;
        }

        const normalizedNewCases = expandedParsed.parsed.map((tc, idx) => normalizeCase(tc, cases.length + idx));
        const before = cases.length;
        cases = mergeUniqueCases(cases, normalizedNewCases);

        if (cases.length === before) {
            break;
        }
    }

    return cases;
}

app.post('/api/generate-test-cases', async (req, res) => {
    res.setHeader('X-AI-Provider', 'openrouter');
    try {
        const { systemPrompt, pdfText, model } = req.body;
        const selectedModel = model || DEFAULT_MODEL;
        const apiKey = process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            if (!process.env.OPENROUTER_API_KEY && process.env.ANTHROPIC_API_KEY) {
            return res.status(500).json({ error: 'OPENROUTER_API_KEY is missing. You still have ANTHROPIC_API_KEY set. Update env vars to OpenRouter.' });
        }
        return res.status(500).json({ error: 'Server API key is not configured. Set OPENROUTER_API_KEY on backend.' });
        }

        if (!pdfText) {
            return res.status(400).json({ error: 'PDF text is required' });
        }

        const cleanPdfText = String(pdfText || '')
            .replace(/\0/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .trim()
            .substring(0, 20000);

        if (!cleanPdfText) {
            return res.status(400).json({ error: 'PDF text is empty or unreadable.' });
        }

        const prompt = `${systemPrompt}\n\n${cleanPdfText}\n\nGenerate API test cases based on this backend documentation.`;

        const { response, raw, data } = await callOpenRouter({
            apiKey,
            model: selectedModel,
            prompt});

        if (!response.ok) {
            console.error('OpenRouter API error:', data || raw);
            if (data && typeof data === 'object') {
                return res.status(response.status).json(data);
            }
            return res.status(response.status).json({
                error: 'OpenRouter API request failed',
                status: response.status,
                details: raw ? raw.substring(0, 500) : 'Empty response body'
            });
        }

        if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
            return res.status(500).json({ error: 'Invalid response structure from OpenRouter API' });
        }

        const initialText = data.choices[0]?.message?.content || '';

        let parsedResult = tryParseJsonArray(initialText);

        if (!parsedResult) {
            const repaired = await repairJsonWithOpenRouter({
                apiKey,
                model: selectedModel,
                invalidOutput: initialText
            });

            if (!repaired.ok) {
                console.error('JSON parse/repair failed:', repaired.reason, repaired.details);
                return res.status(400).json({
                    error: 'Cannot parse AI response as valid JSON',
                    details: repaired.reason,
                    preview: initialText.substring(0, 500)
                });
            }

            parsedResult = repaired.parsed;
        }

        let normalizedCases = parsedResult.parsed.map((tc, idx) => normalizeCase(tc, idx));
        normalizedCases = await ensureMinimumCases({
            apiKey,
            model: selectedModel,
            systemPrompt,
            pdfText: cleanPdfText,
            initialCases: normalizedCases
        });

        return res.json({
            content: [
                {
                    text: JSON.stringify(normalizedCases)
                }
            ]
        });
    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});




