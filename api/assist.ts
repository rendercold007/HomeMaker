import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { SYSTEM_PROMPT, buildAssistPrompt } from './_prompts';
import { extractJson } from './_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY is not configured.' });

  try {
    const body = req.body as Parameters<typeof buildAssistPrompt>[0];
    const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });

    const completion = await client.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek/deepseek-chat',
      max_tokens: 8000,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildAssistPrompt(body) },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? '';
    const json = extractJson(text);
    if (!json) return res.status(500).json({ error: 'Model did not return valid JSON. Raw: ' + text.slice(0, 300) });

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(json);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
