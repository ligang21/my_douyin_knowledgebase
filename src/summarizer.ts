import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';

const client = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION || 'us-west-2',
});

// Cross-region inference profile for Claude Haiku 4.5
const MODEL = process.env.CLAUDE_MODEL || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export interface VideoSummary {
  summary: string;
  tags: string[];
  keyPoints: string[];
  contentType: string;
}

export async function summarizeTranscript(
  title: string | null,
  transcript: string,
): Promise<VideoSummary> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are analyzing a short-form video transcript for a content creator's personal knowledge base.

Video title: ${title ?? '(unknown)'}

Transcript:
${transcript.slice(0, 8000)}

Return a JSON object with exactly these fields:
{
  "summary": "2-3 sentence summary of the video's core message",
  "tags": ["tag1", "tag2", "tag3"],
  "keyPoints": ["point1", "point2", "point3"],
  "contentType": "教程 | 观点 | 案例 | 资讯 | 娱乐"
}

Rules:
- Tags should be concise Chinese topic labels (e.g. AI变现, 自媒体, 工具推荐)
- Key points are the most actionable or memorable takeaways
- Reply with ONLY the JSON object, no markdown, no explanation`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  try {
    return JSON.parse(text) as VideoSummary;
  } catch {
    return {
      summary: text.slice(0, 300),
      tags: [],
      keyPoints: [],
      contentType: '未知',
    };
  }
}
