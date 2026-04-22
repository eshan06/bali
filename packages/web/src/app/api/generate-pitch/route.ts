import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are generating a concise, data-driven one-page district report for a superintendent. Do NOT write a sales email or letter. Instead, write a structured report with these exact sections:

📊 DISTRICT SNAPSHOT
- District name, state, enrollment size, and any relevant demographics

⚠️ THE PROBLEM
- 2-3 bullet points with real data about phone distraction and attendance issues in this specific district or similar districts in the state. Use specific stats where possible.

💸 WHAT IT'S COSTING YOU
- How chronic absenteeism or phone distraction translates to lost state funding or academic outcomes. Be specific with numbers.

✅ HOW BALI HELPS
- 3 bullet points maximum. Focus on: phones locked automatically, attendance tracked in real time, syncs with Canvas/Google Classroom/Blackboard.

🚀 PILOT PROGRAM
- One sentence: 'Bali is currently offering a no-cost pilot program for districts in [state]. 5 minutes to set up. No IT required.'

Keep the entire output under 300 words. Be specific, data-driven, and direct. No fluff.`;

export async function POST(req: NextRequest) {
  try {
    const { districtName, state } = await req.json();

    if (!districtName || !state) {
      return NextResponse.json({ error: 'District name and state are required' }, { status: 400 });
    }

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20260209', name: 'web_search' } as never],
      messages: [
        {
          role: 'user',
          content: `Write a sales pitch for ${districtName} in ${state}. Search for any relevant information about this district — recent news, phone policies, academic challenges, budget situation — and use it to personalize the pitch.`,
        },
      ],
    });

    const response = await stream.finalMessage();

    const textContent = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

    return NextResponse.json({ pitch: textContent });
  } catch (error) {
    console.error('Pitch generation error:', error);
    return NextResponse.json({ error: 'Failed to generate pitch' }, { status: 500 });
  }
}
