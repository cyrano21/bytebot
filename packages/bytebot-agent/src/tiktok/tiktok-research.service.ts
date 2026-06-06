import { Injectable, Logger } from '@nestjs/common';

type TikTokComment = {
  videoUrl?: string;
  videoId?: string;
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

    const webhookUrl = process.env.BYTEBOT_TIKTOK_SCRAPER_URL?.trim();
    if (!webhookUrl) {
      return null;
    }

    const hashtag = this.extractHashtag(description) ?? 'e-commerce';
    const maxComments = this.extractRequestedCount(description) ?? 20;
    const maxVideos = this.extractRequestedVideoCount(description) ?? 5;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.BYTEBOT_TIKTOK_SCRAPER_API_KEY
            ? {
                Authorization: `Bearer ${process.env.BYTEBOT_TIKTOK_SCRAPER_API_KEY}`,
              }
            : {}),
        },
        body: JSON.stringify({
          description,
          hashtag,
          maxComments,
          maxVideos,
          sort: 'most_viewed',
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!response.ok) {
        this.logger.warn(
          `TikTok scraper returned ${response.status}: ${await response.text()}`,
        );
        return null;
      }

      const payload = await response.json();
      const comments = this.normalizeComments(payload).slice(0, maxComments);
      if (comments.length === 0) {
        return null;
      }

      return {
        hashtag,
        comments,
        source: webhookUrl,
        warning:
          comments.length < maxComments
            ? `Only ${comments.length}/${maxComments} comments were returned by the TikTok scraper.`
            : undefined,
      };
    } catch (error) {
      this.logger.warn(
        `TikTok scraper failed: ${error instanceof Error ? error.message : String(error)}`,
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
          comment.videoUrl ?? comment.videoId ?? null,
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
          comment?.text ??
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
          videoId: comment?.videoId ?? comment?.video_id ?? comment?.aweme_id,
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
