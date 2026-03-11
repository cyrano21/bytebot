import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TasksService } from '../tasks/tasks.service';
import { AgentProcessor } from './agent.processor';
import { randomUUID } from 'node:crypto';
import { TaskStatus } from '@prisma/client';
import { writeFile } from './agent.computer-use';

@Injectable()
export class AgentScheduler implements OnModuleInit {
  private readonly logger = new Logger(AgentScheduler.name);
  private readonly runnerId =
    process.env.BYTEBOT_RUNNER_ID?.trim() || randomUUID();
  private readonly leaseDurationMs = this.resolveLeaseDurationMs();
  private isTickRunning = false;

  constructor(
    private readonly tasksService: TasksService,
    private readonly agentProcessor: AgentProcessor,
  ) {}

  getRunnerId(): string {
    return this.runnerId;
  }

  getLeaseDurationMs(): number {
    return this.leaseDurationMs;
  }

  private resolveLeaseDurationMs(): number {
    const parsedValue = Number.parseInt(
      process.env.BYTEBOT_TASK_LEASE_MS ?? '30000',
      10,
    );

    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 30000;
  }

  async onModuleInit() {
    this.logger.log(
      `AgentScheduler initialized with runner ${this.runnerId} and lease ${this.leaseDurationMs}ms`,
    );
    await this.handleCron();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleCron() {
    if (this.isTickRunning) {
      this.logger.warn(
        'Skipping scheduler tick because the previous tick is still running',
      );
      return;
    }

    this.isTickRunning = true;

    try {
      const now = new Date();
      await this.tasksService.recoverStaleRunningTasks(now);
      await this.tasksService.queueDueScheduledTasks(now);

      if (this.agentProcessor.isRunning()) {
        const currentTaskId = this.agentProcessor.getCurrentTaskId();
        if (!currentTaskId) {
          this.logger.warn(
            'AgentProcessor reported a running state without an active task ID; resetting processor state',
          );
          await this.agentProcessor.stopProcessing();
          return;
        }

        const leaseRenewed = await this.tasksService.renewTaskLease(
          currentTaskId,
          this.runnerId,
          this.leaseDurationMs,
        );
        if (!leaseRenewed) {
          this.logger.error(
            `Lost lease ownership for task ${currentTaskId}; stopping local processor`,
          );
          await this.agentProcessor.stopProcessing();
        }
        return;
      }

      const task = await this.tasksService.acquireNextTaskLease(
        this.runnerId,
        this.leaseDurationMs,
      );
      if (!task) {
        return;
      }

      try {
        if (task.files.length > 0) {
          this.logger.debug(
            `Task ID: ${task.id} has files, writing them to the desktop`,
          );
          for (const file of task.files) {
            await writeFile({
              path: `/home/user/Desktop/${file.name}`,
              content: file.data,
            });
          }
        }
      } catch (error: any) {
        const errorMessage = `Failed to prepare task files for task ${task.id}: ${error.message}`;
        this.logger.error(errorMessage, error.stack);
        await this.tasksService.update(task.id, {
          status: TaskStatus.FAILED,
          error: errorMessage,
        });
        return;
      }

      this.logger.debug(
        `Processing task ID: ${task.id} on runner ${this.runnerId}`,
      );
      this.agentProcessor.processTask(task.id);
    } finally {
      this.isTickRunning = false;
    }
  }
}
