import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

    // Handle text content
    if (message.content && message.content.trim() !== '') {
      contentBlocks.push({
        type: MessageContentType.Text,
        text: message.content,
      } as TextContentBlock);
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
