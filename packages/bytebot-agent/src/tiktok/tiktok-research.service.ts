import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type TikTokComment = {
  videoUrl?: string;
  author?: string;
  text: string;
  likes?: number;
};

type TikTokResearchResult = {
  hashtag: string;
  comments: TikTokComment[];
  source: string;
  warning?: string;
};

@Injectable()
export class TikTokResearchService {
  private readonly logger = new Logger(TikTokResearchService.name);

  isCommentExtractionTask(description: string): boolean {
    return (
      /tik\s*tok/i.test(description) &&
      /(commentaire|commentaires|comment|comments)/i.test(description) &&
      /(hashtag|#|vid[ée]o|videos?|plus vues?|most viewed|r[ée]cup[èe]re|extract|collect)/i.test(
        description,
      )
    );
  }

  async collectComments(
    description: string,
  ): Promise<TikTokResearchResult | null> {
    if (!this.isCommentExtractionTask(description)) {
      return null;
    }

    const hashtag = this.extractHashtag(description) ?? 'e-commerce';
    const maxComments = this.extractRequestedCount(description) ?? 20;
    const maxVideos = this.extractRequestedVideoCount(description) ?? 5;

    try {
      const result = await this.collectWithMarketResearchScript(
        hashtag,
        maxComments,
        maxVideos,
      );

      if (!result || result.comments.length === 0) {
        return null;
      }

      return result;
    } catch (error) {
      this.logger.warn(
        `Local TikTok market research failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  formatResult(result: TikTokResearchResult): string {
    const lines = [
      `Commentaires TikTok recuperes pour #${result.hashtag}:`,
      '',
      ...result.comments.map((comment, index) => {
        const parts = [
          `${index + 1}. ${comment.text}`,
          comment.author ? `auteur: ${comment.author}` : null,
          comment.videoUrl ?? null,
          typeof comment.likes === 'number' ? `${comment.likes} likes` : null,
        ].filter(Boolean);

        return parts.join(' | ');
      }),
    ];

    if (result.warning) {
      lines.push('', result.warning);
    }

    return lines.join('\n');
  }

  private async collectWithMarketResearchScript(
    hashtag: string,
    maxComments: number,
    maxVideos: number,
  ): Promise<TikTokResearchResult | null> {
    const scriptPath = join(process.cwd(), 'python', 'market_research.py');
    if (!existsSync(scriptPath)) {
      this.logger.warn(`TikTok market research script not found: ${scriptPath}`);
      return null;
    }

    const pythonBinary = process.env.BYTEBOT_PYTHON_BIN?.trim() || 'python3';
    const { stdout, stderr } = await execFileAsync(
      pythonBinary,
      [
        scriptPath,
        'hashtag-comments',
        hashtag,
        String(maxComments),
        String(maxVideos),
      ],
      {
        timeout: Number(process.env.BYTEBOT_TIKTOK_SCRAPER_TIMEOUT_MS ?? 180_000),
        maxBuffer: 1024 * 1024 * 4,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      },
    );

    const stderrText = String(stderr);
    if (stderrText.trim()) {
      this.logger.debug(`TikTok market research stderr: ${stderrText.trim()}`);
    }

    const payload = this.parseJsonPayload(String(stdout));
    const comments = this.normalizeComments(payload).slice(0, maxComments);
    if (comments.length === 0) {
      return null;
    }

    return {
      hashtag: payload?.hashtag ?? hashtag,
      comments,
      source: 'local:packages/bytebot-agent/python/market_research.py',
      warning:
        comments.length < maxComments
          ? `Only ${comments.length}/${maxComments} comments were recovered locally.`
          : undefined,
    };
  }

  private parseJsonPayload(stdout: string): any {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of [...lines].reverse()) {
      try {
        return JSON.parse(line);
      } catch {
        // Ignore logging lines and keep looking for the JSON result.
      }
    }

    throw new Error('TikTok market research script did not return JSON');
  }

  private normalizeComments(payload: any): TikTokComment[] {
    const rawComments =
      payload?.comments ??
      payload?.data?.comments ??
      payload?.data ??
      payload?.results ??
      [];

    if (!Array.isArray(rawComments)) {
      return [];
    }

    return rawComments
      .map((comment): TikTokComment | null => {
        const text =
          typeof comment === 'string'
            ? comment
            : comment?.text ??
              comment?.comment ??
              comment?.comment_text ??
              comment?.content ??
              comment?.reply_comment?.text;

        if (typeof text !== 'string' || !text.trim()) {
          return null;
        }

        return {
          text: text.trim(),
          author:
            comment?.author ??
            comment?.user?.nickname ??
            comment?.user?.unique_id ??
            comment?.user_name,
          videoUrl: comment?.videoUrl ?? comment?.video_url ?? comment?.url,
          likes:
            typeof comment?.likes === 'number'
              ? comment.likes
              : typeof comment?.digg_count === 'number'
                ? comment.digg_count
                : undefined,
        };
      })
      .filter((comment): comment is TikTokComment => Boolean(comment));
  }

  private extractHashtag(description: string): string | null {
    const explicitHash = description.match(/#([\p{L}\p{N}_-]+)/iu)?.[1];
    if (explicitHash) {
      return explicitHash;
    }

    return (
      description.match(/\bhashtag\s+([\p{L}\p{N}_-]+)/iu)?.[1] ?? null
    );
  }

  private extractRequestedCount(description: string): number | null {
    const match = description.match(/\b(\d{1,3})\s+commentaires?\b/i);
    if (!match?.[1]) {
      return null;
    }

    return Math.max(1, Math.min(Number.parseInt(match[1], 10), 100));
  }

  private extractRequestedVideoCount(description: string): number | null {
    const match = description.match(/\b(\d{1,2})\s+vid[ée]os?\b/i);
    if (!match?.[1]) {
      return null;
    }

    return Math.max(1, Math.min(Number.parseInt(match[1], 10), 20));
  }
}
