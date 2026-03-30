import { TasksService } from '../tasks/tasks.service';
import { MessagesService } from '../messages/messages.service';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Message,
  Prisma,
  Role,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { AnthropicService } from '../anthropic/anthropic.service';
import {
  isComputerToolUseContentBlock,
  isSetTaskStatusToolUseBlock,
  isCreateTaskToolUseBlock,
  SetTaskStatusToolUseBlock,
} from '@bytebot/shared';

import {
  MessageContentBlock,
  MessageContentType,
  ToolResultContentBlock,
  TextContentBlock,
} from '@bytebot/shared';
import { InputCaptureService } from './input-capture.service';
import { OnEvent } from '@nestjs/event-emitter';
import { OpenAIService } from '../openai/openai.service';
import { GoogleService } from '../google/google.service';
import {
  BytebotAgentModel,
  BytebotAgentService,
  BytebotAgentResponse,
} from './agent.types';
import {
  AGENT_SYSTEM_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
} from './agent.constants';
import { SummariesService } from '../summaries/summaries.service';
import {
  dismissTransientUi,
  bootstrapFirefoxResearch,
  handleComputerToolUse,
} from './agent.computer-use';
import { ProxyService } from '../proxy/proxy.service';
import {
  getFallbackModels,
  markModelTemporarilyUnavailable,
  resolveExecutableModel,
} from '../models/available-models';

const MAX_RETRYABLE_SERVICE_ATTEMPTS = 5;
const BROWSER_BOOTSTRAP_MARKER = '[BYTEBOT_BROWSER_BOOTSTRAP]';
const BROWSER_TOOL_REMINDER_MARKER = '[BYTEBOT_BROWSER_TOOL_REQUIRED]';
const BROWSER_COMPLETION_REMINDER_MARKER =
  '[BYTEBOT_BROWSER_COMPLETION_REQUIRED]';
const MAX_BROWSER_TOOL_ACTIONS_BEFORE_COMPLETION_REMINDER = 10;
const MAX_BROWSER_TOOL_ACTIONS_BEFORE_REVIEW = 24;

@Injectable()
export class AgentProcessor {
  private readonly logger = new Logger(AgentProcessor.name);
  private currentTaskId: string | null = null;
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private services: Record<string, BytebotAgentService> = {};
  private readonly serviceCallTimeoutMs = this.resolveServiceCallTimeoutMs();

  constructor(
    private readonly tasksService: TasksService,
    private readonly messagesService: MessagesService,
    private readonly summariesService: SummariesService,
    private readonly anthropicService: AnthropicService,
    private readonly openaiService: OpenAIService,
    private readonly googleService: GoogleService,
    private readonly proxyService: ProxyService,
    private readonly inputCaptureService: InputCaptureService,
  ) {
    this.services = {
      anthropic: this.anthropicService,
      openai: this.openaiService,
      google: this.googleService,
      proxy: this.proxyService,
    };
    this.logger.log('AgentProcessor initialized');
  }

  private resolveServiceCallTimeoutMs(): number {
    const parsedValue = Number.parseInt(
      process.env.BYTEBOT_MODEL_TIMEOUT_MS ?? '90000',
      10,
    );

    return Number.isFinite(parsedValue) && parsedValue > 0
      ? parsedValue
      : 90000;
  }

  private resetProcessingState() {
    this.isProcessing = false;
    this.currentTaskId = null;
  }

  private isTaskMissingError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
        ? Number((error as { status: number }).status)
        : null;

    return (
      error instanceof NotFoundException ||
      status === 404 ||
      (message.includes('task with id') && message.includes('not found'))
    );
  }

  private isBrowserTask(description: string): boolean {
    return /firefox|browser|google|internet|website|web site|site web|navigate|url|search|recherche|tiktok|shopify|oberlo/i.test(
      description,
    );
  }

  private flattenMessageContent(messages: Message[]): MessageContentBlock[] {
    return messages.flatMap(
      (message) => (message.content as MessageContentBlock[]) ?? [],
    );
  }

  private textBlocks(messages: Message[]): TextContentBlock[] {
    return this.flattenMessageContent(messages).filter(
      (block): block is TextContentBlock =>
        block.type === MessageContentType.Text,
    );
  }

  private hasMarker(messages: Message[], marker: string): boolean {
    return this.textBlocks(messages).some((block) => block.text.includes(marker));
  }

  private hasComputerAutomationEvidence(messages: Message[]): boolean {
    return this.flattenMessageContent(messages).some((block) => {
      if (
        block.type === MessageContentType.ToolUse ||
        block.type === MessageContentType.ToolResult ||
        isComputerToolUseContentBlock(block)
      ) {
        return true;
      }

      return (
        block.type === MessageContentType.UserAction &&
        block.content?.some((nestedBlock) =>
          isComputerToolUseContentBlock(nestedBlock),
        )
      );
    });
  }

  private isSearchVisibilityTask(description: string): boolean {
    return /search|recherche|duckduckgo|bing|google|result/i.test(description);
  }

  private hasSimpleVisibleStopCondition(description: string): boolean {
    return /stop once|arr[eê]te[- ]toi|once .* visible|quand .* visible|results? (are )?visible|r[eé]sultats?.*visible/i.test(
      description,
    );
  }

  private countComputerToolUseBlocks(blocks: MessageContentBlock[]): number {
    return blocks.reduce((count, block) => {
      if (isComputerToolUseContentBlock(block)) {
        return count + 1;
      }

      if (block.type === MessageContentType.UserAction) {
        return (
          count +
          (block.content?.filter((nestedBlock) =>
            isComputerToolUseContentBlock(nestedBlock),
          ).length ?? 0)
        );
      }

      return count;
    }, 0);
  }

  private buildBrowserBootstrapBlocks(
    bootstrapResult: Awaited<ReturnType<typeof bootstrapFirefoxResearch>>,
    taskDescription: string,
  ): MessageContentBlock[] {
    const intro =
      bootstrapResult.mode === 'url'
        ? `${BROWSER_BOOTSTRAP_MARKER} Firefox is open on ${bootstrapResult.targetUrl}. Continue from the live browser state.`
        : `${BROWSER_BOOTSTRAP_MARKER} Firefox is open on DuckDuckGo search results for: ${bootstrapResult.query}. Continue from the live browser state.`;

    const completionHint =
      bootstrapResult.mode === 'search' &&
      this.isSearchVisibilityTask(taskDescription) &&
      this.hasSimpleVisibleStopCondition(taskDescription)
        ? ' If the requested stop condition is simply that search results are visible and the current screenshot already shows them, immediately call set_task_status with status "completed" instead of repeating the same search.'
        : '';
    const tiktokHint = /ads\.tiktok\.com\/business\/creativecenter\/top-products/i.test(
      bootstrapResult.targetUrl,
    )
      ? ' On TikTok Creative Center, first dismiss the cookie banner (for example "Decline optional cookies" or "Allow all") and the guided tooltip ("Skip") before exploring. As soon as 2 strong product candidates are visible with enough evidence, call set_task_status instead of spending extra clicks.'
      : '';

    const blocks: MessageContentBlock[] = [
      {
        type: MessageContentType.Text,
        text: `${intro}${completionHint}${tiktokHint} Use the available computer tools to inspect pages, gather evidence, and complete the task. Do not answer from memory.`,
      },
    ];

    if (bootstrapResult.screenshot) {
      blocks.push({
        type: MessageContentType.Image,
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: bootstrapResult.screenshot,
        },
      });
    }

    return blocks;
  }

  private async failTask(taskId: string, errorMessage: string) {
    try {
      await this.tasksService.update(taskId, {
        status: TaskStatus.FAILED,
        error: errorMessage,
      });
    } catch (error) {
      if (!this.isTaskMissingError(error)) {
        throw error;
      }

      this.logger.warn(
        `Skipping failTask update because task ${taskId} no longer exists`,
      );
    } finally {
      this.resetProcessingState();
    }
  }

  private async moveTaskToReview(
    taskId: string,
    errorMessage: string,
    result?: unknown,
  ) {
    try {
      await this.tasksService.update(taskId, {
        status: TaskStatus.NEEDS_REVIEW,
        error: errorMessage,
        ...(result !== undefined ? { result } : {}),
      });
    } catch (error) {
      if (!this.isTaskMissingError(error)) {
        throw error;
      }

      this.logger.warn(
        `Skipping review update because task ${taskId} no longer exists`,
      );
    } finally {
      this.resetProcessingState();
    }
  }

  private async completeTaskFromResponse(
    taskId: string,
    result: MessageContentBlock[],
  ) {
    try {
      await this.tasksService.update(taskId, {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
        result: {
          type: 'assistant_response',
          content: result,
        },
      });
    } catch (error) {
      if (!this.isTaskMissingError(error)) {
        throw error;
      }

      this.logger.warn(
        `Skipping completion update because task ${taskId} no longer exists`,
      );
    } finally {
      this.resetProcessingState();
    }
  }

  private isRetryableServiceError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    return [
      'timed out',
      'timeout',
      'rate limit',
      'quota exceeded',
      'resource_exhausted',
      'insufficient_quota',
      'billing details',
      'temporarily unavailable',
      'connection error',
      'socket hang up',
      'econnreset',
      'not found',
      '429',
      'unknown model',
      'does not exist',
      'provider returned error',
      '503',
      '502',
      '504',
    ].some((pattern) => message.includes(pattern));
  }

  private getErrorStatus(error: unknown): number | null {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
    ) {
      return Number((error as { status: number }).status);
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'number'
    ) {
      return Number((error as { code: number }).code);
    }

    return null;
  }

  private parseRetryAfterMs(message: string): number | null {
    const retryDelayMatch =
      message.match(/retrydelay[^0-9]*(\d+(?:\.\d+)?)s/i) ??
      message.match(/retry in[^0-9]*(\d+(?:\.\d+)?)s/i) ??
      message.match(/retry after[^0-9]*(\d+(?:\.\d+)?)s/i);

    if (!retryDelayMatch) {
      return null;
    }

    return Math.ceil(Number(retryDelayMatch[1]) * 1000);
  }

  private registerServiceFailure(
    model: BytebotAgentModel,
    error: unknown,
  ): void {
    const rawMessage =
      error instanceof Error ? error.message : String(error);
    const message = rawMessage.toLowerCase();
    const status = this.getErrorStatus(error);
    const retryAfterMs = this.parseRetryAfterMs(rawMessage);

    let scope: 'model' | 'provider' | null = null;
    let cooldownMs = 0;
    let reason = rawMessage;

    if (
      status === 401 ||
      status === 403 ||
      message.includes('invalid api key') ||
      message.includes('authentication') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')
    ) {
      scope = 'provider';
      cooldownMs = 30 * 60 * 1000;
    } else if (
      message.includes('quota exceeded') ||
      message.includes('resource_exhausted') ||
      message.includes('insufficient_quota') ||
      message.includes('billing details')
    ) {
      scope = 'provider';
      cooldownMs = Math.max(retryAfterMs ?? 0, 15 * 60 * 1000);
    } else if (status === 429 || message.includes('rate limit')) {
      scope = 'model';
      cooldownMs = Math.max(retryAfterMs ?? 0, 60 * 1000);
    } else if (status === 400 && message.includes('provider returned error')) {
      scope = 'model';
      cooldownMs = Math.max(retryAfterMs ?? 0, 60 * 1000);
    } else if (
      message.includes('not found') ||
      message.includes('unknown model') ||
      message.includes('does not exist')
    ) {
      scope = 'model';
      cooldownMs = 60 * 60 * 1000;
    } else if (
      message.includes('timed out') ||
      message.includes('timeout') ||
      message.includes('temporarily unavailable') ||
      message.includes('connection error') ||
      message.includes('socket hang up') ||
      message.includes('econnreset') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    ) {
      scope = 'model';
      cooldownMs = Math.max(retryAfterMs ?? 0, 60 * 1000);
    }

    if (!scope || cooldownMs <= 0) {
      return;
    }

    markModelTemporarilyUnavailable(model, cooldownMs, reason, scope);
    this.logger.warn(
      `Temporarily excluding ${scope === 'provider' ? `provider ${model.provider}` : `model ${model.provider}:${model.name}`} for ${Math.ceil(cooldownMs / 1000)}s after service failure`,
    );
  }

  private async retryTaskWithFallbackModel(
    task: Task,
  ): Promise<boolean> {
    if (task.runAttemptCount >= MAX_RETRYABLE_SERVICE_ATTEMPTS) {
      return false;
    }

    const currentModel = task.model as unknown as BytebotAgentModel;
    const fallbackModels = await getFallbackModels(currentModel);
    const fallbackModel = fallbackModels[task.runAttemptCount - 1];

    if (!fallbackModel) {
      return false;
    }

    this.logger.warn(
      `Task ${task.id} failed with ${currentModel.provider}:${currentModel.name}; retrying with fallback ${fallbackModel.provider}:${fallbackModel.name}`,
    );
    await this.tasksService.requeueWithModel(task.id, fallbackModel as unknown as Prisma.JsonObject);
    this.resetProcessingState();

    return true;
  }

  private async generateMessageWithTimeout(
    service: BytebotAgentService,
    systemPrompt: string,
    messages: Message[],
    modelName: string,
    useTools: boolean,
  ): Promise<BytebotAgentResponse> {
    const activeAbortController = this.abortController ?? new AbortController();
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      timeoutController.abort(
        new Error(
          `Model service timed out after ${this.serviceCallTimeoutMs}ms`,
        ),
      );
    }, this.serviceCallTimeoutMs);

    const relayAbort = () => {
      timeoutController.abort(activeAbortController.signal.reason);
    };
    activeAbortController.signal.addEventListener('abort', relayAbort, {
      once: true,
    });

    try {
      return await service.generateMessage(
        systemPrompt,
        messages,
        modelName,
        useTools,
        timeoutController.signal,
      );
    } catch (error) {
      if (
        timeoutController.signal.aborted &&
        !activeAbortController.signal.aborted
      ) {
        throw new Error(
          `Model service timed out after ${this.serviceCallTimeoutMs}ms`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      activeAbortController.signal.removeEventListener('abort', relayAbort);
    }
  }

  /**
   * Check if the processor is currently processing a task
   */
  isRunning(): boolean {
    return this.isProcessing;
  }

  /**
   * Get the current task ID being processed
   */
  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  @OnEvent('task.takeover')
  handleTaskTakeover({ taskId }: { taskId: string }) {
    this.logger.log(`Task takeover event received for task ID: ${taskId}`);

    // If the agent is still processing this task, abort any in-flight operations
    if (this.currentTaskId === taskId && this.isProcessing) {
      this.abortController?.abort();
      this.resetProcessingState();
    }

    // Always start capturing user input so that emitted actions are received
    this.inputCaptureService.start(taskId);
  }

  @OnEvent('task.resume')
  handleTaskResume({ taskId }: { taskId: string }) {
    this.logger.log(
      `Task resume event received for task ID: ${taskId}; waiting for scheduler lease reacquisition`,
    );
  }

  @OnEvent('task.cancel')
  async handleTaskCancel({ taskId }: { taskId: string }) {
    this.logger.log(`Task cancel event received for task ID: ${taskId}`);

    await this.stopProcessing();
  }

  processTask(taskId: string) {
    this.logger.log(`Starting processing for task ID: ${taskId}`);

    if (this.isProcessing) {
      this.logger.warn('AgentProcessor is already processing another task');
      return;
    }

    this.isProcessing = true;
    this.currentTaskId = taskId;
    this.abortController = new AbortController();

    // Kick off the first iteration without blocking the caller
    void this.runIteration(taskId);
  }

  /**
   * Runs a single iteration of task processing and schedules the next
   * iteration via setImmediate while the task remains RUNNING.
   */
  private async runIteration(taskId: string): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    try {
      const task: Task = await this.tasksService.findById(taskId);

      if (task.status !== TaskStatus.RUNNING) {
        this.logger.log(
          `Task processing completed for task ID: ${taskId} with status: ${task.status}`,
        );
        this.resetProcessingState();
        return;
      }

      this.logger.log(`Processing iteration for task ID: ${taskId}`);

      // Refresh abort controller for this iteration to avoid accumulating
      // "abort" listeners on a single AbortSignal across iterations.
      this.abortController = new AbortController();

      const latestSummary = await this.summariesService.findLatest(taskId);
      const unsummarizedMessages =
        await this.messagesService.findUnsummarized(taskId);
      const messages = [
        ...(latestSummary
          ? [
              {
                id: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                taskId,
                summaryId: null,
                userId: null,
                role: Role.USER,
                content: [
                  {
                    type: MessageContentType.Text,
                    text: latestSummary.content,
                  },
                ],
              },
            ]
          : []),
        ...unsummarizedMessages,
      ];

      const isFreshTaskContext =
        !latestSummary &&
        messages.length === 1 &&
        messages[0]?.role === Role.USER;

      if (isFreshTaskContext) {
        try {
          this.logger.log(
            `Running transient UI cleanup before first iteration for task ${taskId}`,
          );
          await dismissTransientUi();

          if (this.isBrowserTask(task.description)) {
            this.logger.log(
              `Resetting Firefox workspace before first browser iteration for task ${taskId}`,
            );
            const bootstrapResult =
              await bootstrapFirefoxResearch(task.description);
            const bootstrapBlocks = this.buildBrowserBootstrapBlocks(
              bootstrapResult,
              task.description,
            );
            const persistedBootstrapMessage = await this.messagesService.create({
              content: bootstrapBlocks,
              role: Role.USER,
              taskId,
            });
            messages.push(persistedBootstrapMessage);
          }
        } catch (error) {
          this.logger.warn(
            `Transient UI cleanup failed for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.debug(
        `Sending ${messages.length} messages to LLM for processing`,
      );

      const requestedModel = task.model as unknown as BytebotAgentModel;
      const { model, usedFallback } =
        await resolveExecutableModel(requestedModel);
      if (!model) {
        const errorMessage =
          'No executable AI model is currently available for this task';
        this.logger.error(`CRITICAL ERROR: ${errorMessage}`);
        await this.failTask(taskId, errorMessage);
        return;
      }

      if (usedFallback) {
        this.logger.warn(
          `Task ${taskId} requested unavailable model ${requestedModel.provider}:${requestedModel.name}; executing with fallback ${model.provider}:${model.name}`,
        );
      }

      this.logger.log(`Task model: ${JSON.stringify(model)}`);
      this.logger.log(
        `Available services: ${Object.keys(this.services).join(', ')}`,
      );

      let agentResponse: BytebotAgentResponse;

      const service = this.services[model.provider];
      if (!service) {
        const errorMessage = `No service found for model provider: ${model.provider}. Available providers: ${Object.keys(this.services).join(', ')}`;
        this.logger.error(`CRITICAL ERROR: ${errorMessage}`);
        await this.failTask(taskId, errorMessage);
        return;
      }

      this.logger.log(`Using service for provider: ${model.provider}`);

      try {
        this.logger.log(`Calling service.generateMessage for task ${taskId}`);
        agentResponse = await this.generateMessageWithTimeout(
          service,
          AGENT_SYSTEM_PROMPT,
          messages,
          model.name,
          true,
        );
        this.logger.log(`Service call successful for task ${taskId}`);
      } catch (error) {
        if (error instanceof Error && error.name === 'BytebotAgentInterrupt') {
          throw error;
        }

        const errorMessage = `Service call failed for task ${taskId}: ${error.message}`;
        this.logger.error(`CRITICAL ERROR: ${errorMessage}`);
        this.logger.error(`Error details: ${JSON.stringify(error)}`);
        this.registerServiceFailure(model, error);
        if (this.isRetryableServiceError(error)) {
          const retried = await this.retryTaskWithFallbackModel(task);
          if (retried) {
            return;
          }
        }
        await this.failTask(taskId, errorMessage);
        return;
      }

      const messageContentBlocks = agentResponse.contentBlocks;

      this.logger.debug(
        `Received ${messageContentBlocks.length} content blocks from LLM`,
      );

      if (messageContentBlocks.length === 0) {
        const errorMessage = `Task ID: ${taskId} received no content blocks from LLM`;
        this.logger.warn(`${errorMessage}, marking as failed`);
        await this.failTask(taskId, errorMessage);
        return;
      }

      await this.messagesService.create({
        content: messageContentBlocks,
        role: Role.ASSISTANT,
        taskId,
      });

      // Calculate if we need to summarize based on token usage
      const contextWindow = model.contextWindow || 200000; // Default to 200k if not specified
      const contextThreshold = contextWindow * 0.75;
      const shouldSummarize =
        agentResponse.tokenUsage.totalTokens >= contextThreshold;

      if (shouldSummarize) {
        try {
          // After we've successfully generated a response, we can summarize the unsummarized messages
          const summaryResponse = await this.generateMessageWithTimeout(
            service,
            SUMMARIZATION_SYSTEM_PROMPT,
            [
              ...messages,
              {
                id: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                taskId,
                summaryId: null,
                userId: null,
                role: Role.USER,
                content: [
                  {
                    type: MessageContentType.Text,
                    text: 'Respond with a summary of the messages above. Do not include any additional information.',
                  },
                ],
              },
            ],
            model.name,
            false,
          );

          const summaryContentBlocks = summaryResponse.contentBlocks;

          this.logger.debug(
            `Received ${summaryContentBlocks.length} summary content blocks from LLM`,
          );
          const summaryContent = summaryContentBlocks
            .filter(
              (block: MessageContentBlock) =>
                block.type === MessageContentType.Text,
            )
            .map((block: TextContentBlock) => block.text)
            .join('\n');

          const summary = await this.summariesService.create({
            content: summaryContent,
            taskId,
          });

          await this.messagesService.attachSummary(taskId, summary.id, [
            ...messages.map((message) => {
              return message.id;
            }),
          ]);

          this.logger.log(
            `Generated summary for task ${taskId} due to token usage (${agentResponse.tokenUsage.totalTokens}/${contextWindow})`,
          );
        } catch (error: any) {
          this.logger.error(
            `Error summarizing messages for task ID: ${taskId}`,
            error.stack,
          );
        }
      }

      this.logger.debug(
        `Token usage for task ${taskId}: ${agentResponse.tokenUsage.totalTokens}/${contextWindow} (${Math.round((agentResponse.tokenUsage.totalTokens / contextWindow) * 100)}%)`,
      );

      const generatedToolResults: ToolResultContentBlock[] = [];

      let setTaskStatusToolUseBlock: SetTaskStatusToolUseBlock | null = null;

      for (const block of messageContentBlocks) {
        if (isComputerToolUseContentBlock(block)) {
          const result = await handleComputerToolUse(block, this.logger);
          generatedToolResults.push(result);
        }

        if (isCreateTaskToolUseBlock(block)) {
          const type = block.input.type?.toUpperCase() as TaskType;
          const priority = block.input.priority?.toUpperCase() as TaskPriority;

          await this.tasksService.create({
            description: block.input.description,
            type,
            createdBy: Role.ASSISTANT,
            ...(block.input.scheduledFor && {
              scheduledFor: new Date(block.input.scheduledFor),
            }),
            model: task.model,
            priority,
          });

          generatedToolResults.push({
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            content: [
              {
                type: MessageContentType.Text,
                text: 'The task has been created',
              },
            ],
          });
        }

        if (isSetTaskStatusToolUseBlock(block)) {
          setTaskStatusToolUseBlock = block;

          generatedToolResults.push({
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            is_error: block.input.status === 'failed',
            content: [
              {
                type: MessageContentType.Text,
                text: block.input.description,
              },
            ],
          });
        }
      }

      if (generatedToolResults.length > 0) {
        await this.messagesService.create({
          content: generatedToolResults,
          role: Role.USER,
          taskId,
        });
      }

      // Update the task status after all tool results have been generated if we have a set task status tool use block
      if (setTaskStatusToolUseBlock) {
        const taskResult = {
          type: 'set_task_status',
          status: setTaskStatusToolUseBlock.input.status,
          description: setTaskStatusToolUseBlock.input.description,
        } satisfies Prisma.JsonObject;

        switch (setTaskStatusToolUseBlock.input.status) {
          case 'completed':
            await this.tasksService.update(taskId, {
              status: TaskStatus.COMPLETED,
              completedAt: new Date(),
              result: taskResult,
            });
            break;
          case 'needs_help':
            await this.tasksService.update(taskId, {
              status: TaskStatus.NEEDS_HELP,
              error: setTaskStatusToolUseBlock.input.description,
              result: taskResult,
            });
            break;
        }
      }

      const browserTaskHistory = this.isBrowserTask(task.description)
        ? await this.messagesService.findEvery(taskId)
        : null;

      const hasTextResponse = messageContentBlocks.some(
        (block) => block.type === MessageContentType.Text,
      );
      const hasActionableFollowUp =
        generatedToolResults.length > 0 || !!setTaskStatusToolUseBlock;

      if (!hasActionableFollowUp) {
        if (hasTextResponse) {
          if (this.isBrowserTask(task.description)) {
            const browserMessages = browserTaskHistory ?? messages;
            if (
              !this.hasComputerAutomationEvidence(browserMessages) &&
              !this.hasMarker(browserMessages, BROWSER_TOOL_REMINDER_MARKER)
            ) {
              this.logger.warn(
                `Task ${taskId} produced text without browser actions; requesting an explicit computer-tool step`,
              );
              await this.messagesService.create({
                content: [
                  {
                    type: MessageContentType.Text,
                    text: `${BROWSER_TOOL_REMINDER_MARKER} The browser is already open on a live page. Your next response must use at least one computer_* tool or set_task_status. Do not reply with analysis from memory.`,
                  },
                ],
                role: Role.USER,
                taskId,
              });

              if (this.isProcessing) {
                setImmediate(() => this.runIteration(taskId));
              }
              return;
            }

            const errorMessage =
              'Browser task ended with text only and no computer action';
            this.logger.warn(`Task ${taskId}: ${errorMessage}`);
            await this.moveTaskToReview(taskId, errorMessage, {
              content: messageContentBlocks,
            });
            return;
          }

          this.logger.log(
            `Task ${taskId} produced a terminal text response without follow-up tools; completing automatically`,
          );
          await this.completeTaskFromResponse(taskId, messageContentBlocks);
          return;
        }

        const errorMessage =
          'Agent response contained no executable action and no terminal task status';
        this.logger.warn(`Task ${taskId}: ${errorMessage}`);
        await this.moveTaskToReview(taskId, errorMessage, {
          content: messageContentBlocks,
        });
        return;
      }

      if (this.isBrowserTask(task.description) && !setTaskStatusToolUseBlock) {
        const browserMessages = browserTaskHistory ?? messages;
        const computerActionCount = this.countComputerToolUseBlocks([
          ...this.flattenMessageContent(browserMessages),
        ]);
        const hasCompletionReminder = this.hasMarker(
          browserMessages,
          BROWSER_COMPLETION_REMINDER_MARKER,
        );

        if (
          computerActionCount >= MAX_BROWSER_TOOL_ACTIONS_BEFORE_REVIEW &&
          hasCompletionReminder
        ) {
          const errorMessage = `Browser task exceeded ${computerActionCount} computer actions without reaching a terminal status`;
          this.logger.warn(`Task ${taskId}: ${errorMessage}`);
          await this.moveTaskToReview(taskId, errorMessage, {
            content: messageContentBlocks,
            computerActionCount,
          });
          return;
        }

        if (
          computerActionCount >=
            MAX_BROWSER_TOOL_ACTIONS_BEFORE_COMPLETION_REMINDER &&
          !hasCompletionReminder
        ) {
          this.logger.warn(
            `Task ${taskId} exceeded browser action budget (${computerActionCount}); requesting explicit completion`,
          );
          await this.messagesService.create({
            content: [
              {
                type: MessageContentType.Text,
                text: `${BROWSER_COMPLETION_REMINDER_MARKER} The requested browser state may already be visible. If the user's stop condition is already satisfied, your next response must call set_task_status with status "completed" and a short summary. Only continue using computer_* tools if a concrete page change is still required.`,
              },
            ],
            role: Role.USER,
            taskId,
          });

          if (this.isProcessing) {
            setImmediate(() => this.runIteration(taskId));
          }
          return;
        }
      }

      // Schedule the next iteration without blocking
      if (this.isProcessing) {
        setImmediate(() => this.runIteration(taskId));
      }
    } catch (error: any) {
      if (error?.name === 'BytebotAgentInterrupt') {
        this.logger.warn(`Processing aborted for task ID: ${taskId}`);
      } else if (this.isTaskMissingError(error)) {
        this.logger.warn(
          `Stopping processing because task ${taskId} was deleted during execution`,
        );
        this.resetProcessingState();
      } else {
        const errorMessage = `Error during task processing iteration for task ID: ${taskId} - ${error.message}`;
        this.logger.error(
          errorMessage,
          error.stack,
        );
        await this.failTask(taskId, errorMessage);
      }
    }
  }

  async stopProcessing(): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    this.logger.log(`Stopping execution of task ${this.currentTaskId}`);

    // Signal any in-flight async operations to abort
    this.abortController?.abort();

    await this.inputCaptureService.stop();

    this.resetProcessingState();
  }
}
