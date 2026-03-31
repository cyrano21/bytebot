import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import OpenAI, { APIUserAbortError } from 'openai';
import {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from 'openai/resources/chat/completions';
import {
  MessageContentBlock,
  MessageContentType,
  TextContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
  ImageContentBlock,
  isUserActionContentBlock,
  isComputerToolUseContentBlock,
  isImageContentBlock,
  ThinkingContentBlock,
} from '@bytebot/shared';
import { Message, Role } from '@prisma/client';
import { proxyTools } from './proxy.tools';
import {
  BytebotAgentService,
  BytebotAgentInterrupt,
  BytebotAgentRefusal,
  BytebotAgentResponse,
} from '../agent/agent.types';

const COMPUTER_APPLICATION_NAMES = [
  'firefox',
  '1password',
  'thunderbird',
  'vscode',
  'terminal',
  'desktop',
  'directory',
] as const;

@Injectable()
export class ProxyService implements BytebotAgentService {
  private readonly openai: OpenAI;
  private readonly ollamaClient: OpenAI;
  private readonly logger = new Logger(ProxyService.name);

  constructor(private readonly configService: ConfigService) {
    const proxyUrl = this.configService.get<string>('BYTEBOT_LLM_PROXY_URL');

    if (!proxyUrl) {
      this.logger.warn(
        'BYTEBOT_LLM_PROXY_URL is not set. ProxyService will not work properly.',
      );
    }

    // Initialize OpenAI client with proxy configuration
    this.openai = new OpenAI({
      apiKey: 'dummy-key-for-proxy',
      baseURL: proxyUrl,
    });

    // Initialize direct Ollama client (contourner LiteLLM car il a des bugs)
    this.ollamaClient = new OpenAI({
      apiKey: 'ollama', // Ollama n'utilise pas de clé API
      baseURL: 'http://host.docker.internal:11434/v1',
    });
  }

  /**
   * Main method to generate messages using the Chat Completions API
   */
  async generateMessage(
    systemPrompt: string,
    messages: Message[],
    model: string,
    useTools: boolean = true,
    signal?: AbortSignal,
  ): Promise<BytebotAgentResponse> {
    // Convert messages to Chat Completion format
    const chatMessages = this.formatMessagesForChatCompletion(
      systemPrompt,
      messages,
      model,
    );

    // DEBUG: Log the messages being sent to proxy
    this.logger.log(
      `📨 Sending ${chatMessages.length} messages to proxy for model: ${model}`,
    );
    chatMessages.forEach((msg, idx) => {
      const contentType = Array.isArray(msg.content)
        ? 'array'
        : typeof msg.content;
      this.logger.log(
        `  [${idx}] role=${msg.role} content_type=${contentType}`,
      );
      if (contentType !== 'string' && Array.isArray(msg.content)) {
        msg.content.forEach((c: any, cidx: number) => {
          this.logger.log(`    [${cidx}] type=${c.type || 'unknown'}`);
        });
      }
    });

    try {
      // Désactiver les tools pour Ollama car LiteLLM a des problèmes de compatibilité
      const isOllama = model.includes('ollama');
      const supportsTools = !isOllama;

      // Utiliser le client direct pour Ollama (contourner LiteLLM)
      const client = isOllama ? this.ollamaClient : this.openai;

      // Pour Ollama, convertir ollama-xxx en nom réel depuis models.toml
      let actualModel = model;
      if (isOllama) {
        actualModel = this.mapOllamaModelName(model);
        this.logger.log(
          `🦙 Using direct Ollama client for model: ${actualModel}`,
        );
      }

      // Prepare the Chat Completion request
      const completionRequest: OpenAI.Chat.ChatCompletionCreateParams = {
        model: actualModel,
        messages: chatMessages,
        max_tokens: 4096,
        ...(useTools && supportsTools && { tools: proxyTools }),
        // Note: reasoning_effort is filtered by LiteLLM with drop_params for incompatible models
        // but we keep it here for models that support it (Claude, GPT)
        ...(model.includes('claude') || model.includes('gpt')
          ? { reasoning_effort: 'high' }
          : {}),
      };

      // Make the API call
      const completion = await client.chat.completions.create(
        completionRequest,
        { signal },
      ); // Process the response
      const choice = completion.choices[0];
      if (!choice || !choice.message) {
        throw new Error('No valid response from Chat Completion API');
      }

      // Convert response to MessageContentBlocks
      const contentBlocks = this.formatChatCompletionResponse(choice.message);

      return {
        contentBlocks,
        tokenUsage: {
          inputTokens: completion.usage?.prompt_tokens || 0,
          outputTokens: completion.usage?.completion_tokens || 0,
          totalTokens: completion.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      if (error instanceof APIUserAbortError) {
        this.logger.log('Chat Completion API call aborted');
        throw new BytebotAgentInterrupt();
      }

      this.logger.error(
        `Error sending message to proxy: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Convert Bytebot messages to Chat Completion format
   */
  private formatMessagesForChatCompletion(
    systemPrompt: string,
    messages: Message[],
    model: string,
  ): ChatCompletionMessageParam[] {
    const chatMessages: ChatCompletionMessageParam[] = [];

    // Add system message
    chatMessages.push({
      role: 'system',
      content: systemPrompt,
    });

    // Process each message
    for (const message of messages) {
      const messageContentBlocks = message.content as MessageContentBlock[];

      // Handle user actions specially
      if (
        messageContentBlocks.every((block) => isUserActionContentBlock(block))
      ) {
        const userActionBlocks = messageContentBlocks.flatMap(
          (block) => block.content,
        );

        for (const block of userActionBlocks) {
          if (isComputerToolUseContentBlock(block)) {
            chatMessages.push({
              role: 'user',
              content: `User performed action: ${block.name}\n${JSON.stringify(
                block.input,
                null,
                2,
              )}`,
            });
          } else if (isImageContentBlock(block)) {
            chatMessages.push({
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${block.source.media_type};base64,${block.source.data}`,
                    detail: 'high',
                  },
                },
              ],
            });
          }
        }
      } else {
        for (const block of messageContentBlocks) {
          switch (block.type) {
            case MessageContentType.Text: {
              chatMessages.push({
                role: message.role === Role.USER ? 'user' : 'assistant',
                content: block.text,
              });
              break;
            }
            case MessageContentType.Image: {
              const imageBlock = block as ImageContentBlock;
              chatMessages.push({
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${imageBlock.source.media_type};base64,${imageBlock.source.data}`,
                      detail: 'high',
                    },
                  },
                ],
              });
              break;
            }
            case MessageContentType.ToolUse: {
              const toolBlock = block as ToolUseContentBlock;

              // For Groq and Mistral compatibility, we need to format tool calls more carefully
              const isGroqModel = model && model.includes('groq');
              const isMistralModel = model && model.includes('mistral');

              if (isGroqModel || isMistralModel) {
                // Groq and Mistral: Send as text message to avoid compatibility issues
                chatMessages.push({
                  role: 'assistant',
                  content: `I'll ${toolBlock.name.replace('_', ' ')} for you.`,
                });
              } else {
                // For other models, use standard tool_calls format
                chatMessages.push({
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: toolBlock.id,
                      type: 'function',
                      function: {
                        name: toolBlock.name,
                        arguments: JSON.stringify(toolBlock.input),
                      },
                    },
                  ],
                });
              }
              break;
            }
            case MessageContentType.Thinking: {
              const thinkingBlock = block as ThinkingContentBlock;
              // Only add reasoning_content for models that support it (Claude, GPT)
              // Other models will completely skip this content type to avoid format errors
              if (
                model &&
                (model.includes('claude') || model.includes('gpt'))
              ) {
                // For Claude and GPT, add as assistant message with reasoning_content
                const assistantMessage: any = {
                  role: 'assistant',
                  content: thinkingBlock.thinking, // Some models expect actual content
                };
                // Add the reasoning_content property for models that support it
                assistantMessage['reasoning_content'] = thinkingBlock.thinking;
                chatMessages.push(assistantMessage);
              }
              // For Groq and other models, skip completely to avoid format errors
              break;
            }
            case MessageContentType.ToolResult: {
              const toolResultBlock = block as ToolResultContentBlock;

              // For models like Groq and Mistral that have specific requirements
              const isGroqModel = model && model.includes('groq');
              const isMistralModel = model && model.includes('mistral');

              // Combine all text content for simpler models
              const textContents = toolResultBlock.content
                .filter((c) => c.type === MessageContentType.Text)
                .map((c) => c.text)
                .join('\n');

              const hasImages = toolResultBlock.content.some(
                (c) => c.type === MessageContentType.Image,
              );

              if (isGroqModel || isMistralModel) {
                // For Groq and Mistral: Combine everything into a single user message
                let combinedContent = textContents;
                if (hasImages && !textContents) {
                  combinedContent = '[Screenshot captured from tool]';
                } else if (hasImages && textContents) {
                  combinedContent = textContents + '\n[Screenshot captured]';
                }

                // Only push a message if there's content
                if (combinedContent) {
                  chatMessages.push({
                    role: 'user',
                    content: combinedContent,
                  });
                }
              } else {
                // Standard models: Use proper tool message format
                toolResultBlock.content.forEach((content) => {
                  if (content.type === MessageContentType.Text) {
                    chatMessages.push({
                      role: 'tool',
                      tool_call_id: toolResultBlock.tool_use_id,
                      content: content.text,
                    });
                  } else if (content.type === MessageContentType.Image) {
                    chatMessages.push({
                      role: 'user',
                      content: [
                        {
                          type: 'image_url',
                          image_url: {
                            url: `data:${content.source.media_type};base64,${content.source.data}`,
                            detail: 'low',
                          },
                        },
                      ],
                    });
                  }
                });
              }
              break;
            }
          }
        }
      }
    }

    // CRITICAL FIX for Groq: Ensure all messages have string content BEFORE other fixes
    if (model && model.includes('groq')) {
      chatMessages.forEach((msg, index) => {
        // Skip system messages and tool_calls messages
        if (msg.role === 'system' || (msg as any).tool_calls) {
          return;
        }

        // If content is an array (e.g., with image_url), convert to string
        if (Array.isArray(msg.content)) {
          const hasText = msg.content.some((c: any) => c.type === 'text');
          const hasImage = msg.content.some((c: any) => c.type === 'image_url');

          if (hasImage && !hasText) {
            // If only image, replace with descriptive text
            chatMessages[index] = {
              ...msg,
              content: '[Image/Screenshot provided]',
            };
          } else if (hasText) {
            // If has text, use only the text part
            const textContent = msg.content.find((c: any) => c.type === 'text');
            chatMessages[index] = {
              ...msg,
              content: (textContent as any)?.text || '[Content provided]',
            };
          } else {
            // Fallback for any other array content
            chatMessages[index] = {
              ...msg,
              content: '[Content provided]',
            };
          }

          this.logger.log(
            `📨 Groq fix - Converted array content to string for message ${index} (role=${msg.role})`,
          );
        }

        // Also ensure content is never null/undefined for Groq
        if (!msg.content) {
          chatMessages[index] = {
            ...msg,
            content: '',
          };
        }
      });
    }

    // CRITICAL FIX for Mistral: Handle message order requirements
    if (model && model.includes('mistral')) {
      // Check and fix message ordering issues
      const lastMessage = chatMessages[chatMessages.length - 1];

      this.logger.log(
        `📨 Mistral check - Last message role: ${lastMessage.role}`,
      );

      // Mistral requires last message to be 'user' or 'tool'
      // Since we converted tool_calls to text messages, we always need a user message after assistant
      if (lastMessage.role === 'assistant') {
        this.logger.log(
          `📨 Mistral fix - Last message is assistant, adding user prompt`,
        );
        chatMessages.push({
          role: 'user',
          content: 'Please continue with the task.',
        });
      }
    }
    return chatMessages;
  }

  /**
   * Convert Chat Completion response to MessageContentBlocks
   */
  private formatChatCompletionResponse(
    message: OpenAI.Chat.ChatCompletionMessage,
  ): MessageContentBlock[] {
    const contentBlocks: MessageContentBlock[] = [];
    const hasStructuredToolCalls = (message.tool_calls?.length ?? 0) > 0;

    // Handle text content
    if (message.content && message.content.trim() !== '') {
      contentBlocks.push(
        ...this.parseMessageContent(message.content, !hasStructuredToolCalls),
      );
    }

    if (message['reasoning_content']) {
      contentBlocks.push({
        type: MessageContentType.Thinking,
        thinking: message['reasoning_content'],
        signature: message['reasoning_content'],
      } as ThinkingContentBlock);
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === 'function') {
          let parsedInput = {};
          try {
            parsedInput = JSON.parse(toolCall.function.arguments || '{}');
          } catch (e) {
            this.logger.warn(
              `Failed to parse tool call arguments: ${toolCall.function.arguments}`,
            );
            parsedInput = {};
          }

          contentBlocks.push({
            type: MessageContentType.ToolUse,
            id: toolCall.id,
            name: toolCall.function.name,
            input: parsedInput,
          } as ToolUseContentBlock);
        }
      }
    }

    // Handle refusal
    if (message.refusal) {
      throw new BytebotAgentRefusal(message.refusal);
    }

    // If no content blocks were created, add a default text block to avoid empty responses
    if (contentBlocks.length === 0) {
      this.logger.warn('Received empty response from LLM');
      contentBlocks.push({
        type: MessageContentType.Text,
        text: '[Empty response from model]',
      } as TextContentBlock);
    }

    return contentBlocks;
  }

  private parseMessageContent(
    content: string,
    allowToolCalls: boolean,
  ): MessageContentBlock[] {
    if (!allowToolCalls) {
      return this.buildPlainTextContentBlocks(content);
    }

    const taggedSegments = this.extractTaggedToolCallSegments(content);
    if (taggedSegments.length > 0) {
      return this.buildContentBlocksFromToolSegments(content, taggedSegments);
    }

    const directToolBlocks = this.parseDirectToolCallPayload(content);
    if (directToolBlocks.length > 0) {
      return directToolBlocks;
    }

    return this.buildPlainTextContentBlocks(content);
  }

  private buildPlainTextContentBlocks(content: string): MessageContentBlock[] {
    const contentBlocks: MessageContentBlock[] = [];
    this.pushTextBlock(contentBlocks, content);
    return contentBlocks;
  }

  private extractTaggedToolCallSegments(
    content: string,
  ): Array<{ start: number; end: number; blocks: ToolUseContentBlock[] }> {
    const segments: Array<{
      start: number;
      end: number;
      blocks: ToolUseContentBlock[];
    }> = [];
    const startMarkerRegex = /(?:<)?(?:TOOLCALL|OOLCALL|OLCALL)>/gi;
    let match: RegExpExecArray | null;

    while ((match = startMarkerRegex.exec(content)) !== null) {
      const payloadStart = this.skipWhitespace(
        content,
        match.index + match[0].length,
      );
      const endMarkerRange = this.findToolCallEndMarkerRange(
        content,
        payloadStart,
      );
      const payloadCandidate = this.findBalancedJsonCandidate(
        content,
        payloadStart,
      );
      const repairedPayload =
        !payloadCandidate && endMarkerRange
          ? this.repairIncompleteJsonPayload(
              content.slice(payloadStart, endMarkerRange.start),
            )
          : null;

      const payloadText = payloadCandidate?.json ?? repairedPayload;
      if (!payloadText) {
        continue;
      }

      const blocks = this.parseToolCallMarkup(payloadText);
      if (blocks.length === 0) {
        continue;
      }

      const segmentEnd = endMarkerRange?.end
        ? endMarkerRange.end
        : payloadCandidate
          ? this.consumeOptionalToolCallEndMarker(content, payloadCandidate.end)
          : payloadStart;

      segments.push({
        start: match.index,
        end: segmentEnd,
        blocks,
      });
      startMarkerRegex.lastIndex = segmentEnd;
    }

    return segments;
  }

  private buildContentBlocksFromToolSegments(
    content: string,
    segments: Array<{ start: number; end: number; blocks: ToolUseContentBlock[] }>,
  ): MessageContentBlock[] {
    const contentBlocks: MessageContentBlock[] = [];
    let cursor = 0;

    for (const segment of segments.sort(
      (left, right) => left.start - right.start,
    )) {
      if (segment.start < cursor) {
        continue;
      }

      this.pushTextBlock(contentBlocks, content.slice(cursor, segment.start));
      contentBlocks.push(...segment.blocks);
      cursor = segment.end;
    }

    this.pushTextBlock(contentBlocks, content.slice(cursor));
    return contentBlocks;
  }

  private parseDirectToolCallPayload(content: string): ToolUseContentBlock[] {
    const trimmedContent = content.trim();
    if (trimmedContent === '') {
      return [];
    }

    const unwrappedContent = this.unwrapJsonFence(trimmedContent);
    if (
      unwrappedContent === '' ||
      (unwrappedContent[0] !== '{' && unwrappedContent[0] !== '[')
    ) {
      return [];
    }

    return this.parseToolCallMarkup(unwrappedContent);
  }

  private skipWhitespace(content: string, index: number): number {
    let cursor = index;

    while (cursor < content.length && /\s/.test(content[cursor])) {
      cursor += 1;
    }

    return cursor;
  }

  private findBalancedJsonCandidate(
    content: string,
    startIndex: number,
  ): { start: number; end: number; json: string } | null {
    const jsonStart = this.skipWhitespace(content, startIndex);
    const openingChar = content[jsonStart];

    if (openingChar !== '{' && openingChar !== '[') {
      return null;
    }

    const stack: string[] = [openingChar];
    let inString = false;
    let escaping = false;

    for (let index = jsonStart + 1; index < content.length; index += 1) {
      const currentChar = content[index];

      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }

        if (currentChar === '\\') {
          escaping = true;
          continue;
        }

        if (currentChar === '"') {
          inString = false;
        }

        continue;
      }

      if (currentChar === '"') {
        inString = true;
        continue;
      }

      if (currentChar === '{' || currentChar === '[') {
        stack.push(currentChar);
        continue;
      }

      if (currentChar !== '}' && currentChar !== ']') {
        continue;
      }

      const expectedOpeningChar = currentChar === '}' ? '{' : '[';
      const lastOpeningChar = stack[stack.length - 1];

      if (lastOpeningChar !== expectedOpeningChar) {
        return null;
      }

      stack.pop();

      if (stack.length === 0) {
        return {
          start: jsonStart,
          end: index + 1,
          json: content.slice(jsonStart, index + 1),
        };
      }
    }

    return null;
  }

  private consumeOptionalToolCallEndMarker(
    content: string,
    index: number,
  ): number {
    const trailingContent = content.slice(index);
    const endMarkerMatch = trailingContent.match(
      /^\s*(?:<\/)?(?:TOOLCALL|OOLCALL|OLCALL|CALL|ALL)>/i,
    );

    return endMarkerMatch ? index + endMarkerMatch[0].length : index;
  }

  private findToolCallEndMarkerRange(
    content: string,
    startIndex: number,
  ): { start: number; end: number } | null {
    const trailingContent = content.slice(startIndex);
    const endMarkerMatch = trailingContent.match(
      /\s*(?:<\/)?(?:TOOLCALL|OOLCALL|OLCALL|CALL|ALL)>/i,
    );

    if (endMarkerMatch?.index === undefined) {
      return null;
    }

    const start = startIndex + endMarkerMatch.index;
    return {
      start,
      end: start + endMarkerMatch[0].length,
    };
  }

  private repairIncompleteJsonPayload(payload: string): string | null {
    const repairedApplicationPayload =
      this.repairTruncatedComputerApplicationPayload(payload);

    return this.repairIncompleteJson(
      repairedApplicationPayload ?? payload,
    );
  }

  private repairTruncatedComputerApplicationPayload(
    payload: string,
  ): string | null {
    if (
      !/computer_application/i.test(payload) ||
      !/"application"\s*:\s*"/i.test(payload)
    ) {
      return null;
    }

    const applicationPrefixMatch = payload.match(
      /"application"\s*:\s*"([^"\]}]*)$/i,
    );

    if (!applicationPrefixMatch) {
      return null;
    }

    const partialApplicationName = applicationPrefixMatch[1].toLowerCase();
    if (partialApplicationName === '') {
      return null;
    }

    const matchingApplicationNames = COMPUTER_APPLICATION_NAMES.filter(
      (applicationName) => applicationName.startsWith(partialApplicationName),
    );

    if (matchingApplicationNames.length !== 1) {
      return null;
    }

    return `${payload}${matchingApplicationNames[0].slice(partialApplicationName.length)}"`;
  }

  private repairIncompleteJson(payload: string): string | null {
    const trimmedPayload = payload.trim();
    if (
      trimmedPayload === '' ||
      (trimmedPayload[0] !== '{' && trimmedPayload[0] !== '[')
    ) {
      return null;
    }

    const stack: string[] = [];
    let inString = false;
    let escaping = false;

    for (const currentChar of trimmedPayload) {
      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }

        if (currentChar === '\\') {
          escaping = true;
          continue;
        }

        if (currentChar === '"') {
          inString = false;
        }

        continue;
      }

      if (currentChar === '"') {
        inString = true;
        continue;
      }

      if (currentChar === '{' || currentChar === '[') {
        stack.push(currentChar);
        continue;
      }

      if (currentChar !== '}' && currentChar !== ']') {
        continue;
      }

      const expectedOpeningChar = currentChar === '}' ? '{' : '[';
      const lastOpeningChar = stack[stack.length - 1];

      if (lastOpeningChar !== expectedOpeningChar) {
        return null;
      }

      stack.pop();
    }

    if (inString) {
      return null;
    }

    const closingCharacters = stack
      .reverse()
      .map((openingChar) => (openingChar === '{' ? '}' : ']'))
      .join('');

    return `${trimmedPayload}${closingCharacters}`;
  }

  private pushTextBlock(
    contentBlocks: MessageContentBlock[],
    text: string,
  ): void {
    if (!text || text.trim() === '') {
      return;
    }

    contentBlocks.push({
      type: MessageContentType.Text,
      text,
    } as TextContentBlock);
  }

  private parseToolCallMarkup(payload: string): ToolUseContentBlock[] {
    const sanitizedPayload = this.unwrapJsonFence(payload.trim());

    try {
      return this.normalizeToolCallPayload(JSON.parse(sanitizedPayload));
    } catch (error) {
      this.logger.warn(
        `Failed to parse TOOLCALL payload: ${sanitizedPayload}`,
      );
      return [];
    }
  }

  private unwrapJsonFence(payload: string): string {
    const fencedMatch = payload.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fencedMatch ? fencedMatch[1].trim() : payload;
  }

  private normalizeToolCallPayload(payload: unknown): ToolUseContentBlock[] {
    const candidates = Array.isArray(payload)
      ? payload
      : this.isRecord(payload) && Array.isArray(payload.tool_calls)
        ? payload.tool_calls
        : [payload];

    return candidates
      .map((candidate) => this.normalizeToolCall(candidate))
      .filter((block): block is ToolUseContentBlock => block !== null);
  }

  private normalizeToolCall(candidate: unknown): ToolUseContentBlock | null {
    if (!this.isRecord(candidate)) {
      return null;
    }

    if (typeof candidate.name === 'string' && candidate.name.trim() !== '') {
      return {
        type: MessageContentType.ToolUse,
        id:
          typeof candidate.id === 'string' && candidate.id.trim() !== ''
            ? candidate.id
            : randomUUID(),
        name: candidate.name,
        input: this.normalizeToolInput(
          candidate.input ?? candidate.arguments ?? {},
        ),
      } as ToolUseContentBlock;
    }

    if (
      candidate.type === 'function' &&
      this.isRecord(candidate.function) &&
      typeof candidate.function.name === 'string' &&
      candidate.function.name.trim() !== ''
    ) {
      return {
        type: MessageContentType.ToolUse,
        id:
          typeof candidate.id === 'string' && candidate.id.trim() !== ''
            ? candidate.id
            : randomUUID(),
        name: candidate.function.name,
        input: this.normalizeToolInput(candidate.function.arguments ?? {}),
      } as ToolUseContentBlock;
    }

    return null;
  }

  private normalizeToolInput(input: unknown): Record<string, unknown> {
    if (typeof input === 'string') {
      try {
        const parsedInput = JSON.parse(input);
        return this.isRecord(parsedInput) ? parsedInput : {};
      } catch {
        return {};
      }
    }

    return this.isRecord(input) ? input : {};
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Map Ollama model name from ByteBot format to actual Ollama model name
   * Examples:
   * - ollama-gemma3-12b → gemma3:12b
   * - ollama-qwen3-30b → qwen3:30b
   * - ollama-llama3-1-8b → llama3.1:8b
   * - ollama-deepseek-r1-14b → deepseek-r1:14b
   * - ollama-qwq → qwq:latest
   * - ollama-magistral → huihui_ai/magistral-abliterated:latest
   */
  private mapOllamaModelName(modelName: string): string {
    // Map des noms spéciaux (depuis models.toml)
    const modelMap: Record<string, string> = {
      'ollama-qwen3-30b': 'qwen3:30b',
      'ollama-gemma3-12b': 'gemma3:12b',
      'ollama-gemma3-27b': 'gemma3:27b',
      'ollama-llama3-1-8b': 'llama3.1:8b',
      'ollama-deepseek-r1-14b': 'deepseek-r1:14b',
      'ollama-deepseek-r1-32b': 'deepseek-r1:32b',
      'ollama-qwq': 'qwq:latest',
      'ollama-magistral': 'huihui_ai/magistral-abliterated:latest',
    };

    const mapped = modelMap[modelName];
    if (mapped) {
      return mapped;
    }

    // Fallback: simple conversion (ollama-xxx → xxx:latest)
    const fallback = modelName.replace('ollama-', '') + ':latest';
    this.logger.warn(
      `Unknown Ollama model ${modelName}, using fallback: ${fallback}`,
    );
    return fallback;
  }
}
