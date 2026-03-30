import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  Task,
  Role,
  Prisma,
  TaskStatus,
  TaskType,
  TaskPriority,
  File,
} from '@prisma/client';
import { AddTaskMessageDto } from './dto/add-task-message.dto';
import { TasksGateway } from './tasks.gateway';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BytebotAgentModel } from '../agent/agent.types';
import { resolveExecutableModel } from '../models/available-models';

const TASK_PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  [TaskPriority.LOW]: 1,
  [TaskPriority.MEDIUM]: 2,
  [TaskPriority.HIGH]: 3,
  [TaskPriority.URGENT]: 4,
};

type TaskWithFiles = Task & { files: File[] };

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    readonly prisma: PrismaService,
    @Inject(forwardRef(() => TasksGateway))
    private readonly tasksGateway: TasksGateway,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.logger.log('TasksService initialized');
  }

  private getTaskQueueTimestamp(task: Pick<Task, 'queuedAt' | 'scheduledFor' | 'createdAt'>): number {
    return (
      task.queuedAt?.getTime() ??
      task.scheduledFor?.getTime() ??
      task.createdAt.getTime()
    );
  }

  private sortTasksForExecution(tasks: TaskWithFiles[]): TaskWithFiles[] {
    return [...tasks].sort((left, right) => {
      const priorityDelta =
        TASK_PRIORITY_WEIGHT[right.priority] - TASK_PRIORITY_WEIGHT[left.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const queueDelta =
        this.getTaskQueueTimestamp(left) - this.getTaskQueueTimestamp(right);
      if (queueDelta !== 0) {
        return queueDelta;
      }

      return left.createdAt.getTime() - right.createdAt.getTime();
    });
  }

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const description =
      typeof createTaskDto?.description === 'string'
        ? createTaskDto.description.trim()
        : '';
    if (!description) {
      throw new BadRequestException(
        'Task description is required to create a task',
      );
    }

    this.logger.log(
      `Creating new task with description: ${description}`,
    );

    const requestedModel =
      (createTaskDto.model as BytebotAgentModel | undefined) ?? null;
    const { model: resolvedModel, usedFallback } =
      await resolveExecutableModel(requestedModel);
    if (!resolvedModel) {
      throw new BadRequestException(
        'No AI model is configured or currently available for task execution',
      );
    }

    if (usedFallback && requestedModel) {
      this.logger.warn(
        `Requested model ${requestedModel.provider}:${requestedModel.name} is unavailable; falling back to ${resolvedModel.provider}:${resolvedModel.name}`,
      );
    }

    const task = await this.prisma.$transaction(async (prisma) => {
      // Create the task first
        this.logger.debug('Creating task record in database');
        const task = await prisma.task.create({
          data: {
            description,
            type: createTaskDto.type || TaskType.IMMEDIATE,
            priority: createTaskDto.priority || TaskPriority.MEDIUM,
            status: TaskStatus.PENDING,
          createdBy: createTaskDto.createdBy || Role.USER,
          model: resolvedModel as unknown as Prisma.InputJsonValue,
          ...(createTaskDto.scheduledFor
            ? { scheduledFor: createTaskDto.scheduledFor }
            : {}),
        },
      });
      this.logger.log(`Task created successfully with ID: ${task.id}`);

      let filesDescription = '';

      // Save files if provided
      if (createTaskDto.files && createTaskDto.files.length > 0) {
        this.logger.debug(
          `Saving ${createTaskDto.files.length} file(s) for task ID: ${task.id}`,
        );
        filesDescription += `\n`;

        const filePromises = createTaskDto.files.map((file) => {
          // Extract base64 data without the data URL prefix
          const base64Data = file.base64.includes('base64,')
            ? file.base64.split('base64,')[1]
            : file.base64;

          filesDescription += `\nFile ${file.name} written to desktop.`;

          return prisma.file.create({
            data: {
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size,
              data: base64Data,
              taskId: task.id,
            },
          });
        });

        await Promise.all(filePromises);
        this.logger.debug(`Files saved successfully for task ID: ${task.id}`);
      }

      // Create the initial system message
      this.logger.debug(`Creating initial message for task ID: ${task.id}`);
      await prisma.message.create({
        data: {
          content: [
              {
                type: 'text',
                text: `${description} ${filesDescription}`,
              },
            ] as Prisma.InputJsonValue,
            role: Role.USER,
          taskId: task.id,
        },
      });
      this.logger.debug(`Initial message created for task ID: ${task.id}`);

      return task;
    });

    this.tasksGateway.emitTaskCreated(task);

    return task;
  }

  async queueDueScheduledTasks(now = new Date()): Promise<number> {
    const result = await this.prisma.task.updateMany({
      where: {
        status: TaskStatus.PENDING,
        type: TaskType.SCHEDULED,
        control: Role.ASSISTANT,
        scheduledFor: {
          lte: now,
        },
        queuedAt: null,
      },
      data: {
        queuedAt: now,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Queued ${result.count} scheduled task(s) due for execution`);
    }

    return result.count;
  }

  async recoverStaleRunningTasks(now = new Date()): Promise<number> {
    const staleTasks = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.RUNNING,
        control: Role.ASSISTANT,
        OR: [
          {
            leaseExpiresAt: {
              lte: now,
            },
          },
          {
            leaseOwner: null,
          },
        ],
      },
    });

    if (staleTasks.length === 0) {
      return 0;
    }

    const recoveredTaskIds = staleTasks.map((task) => task.id);
    const result = await this.prisma.task.updateMany({
      where: {
        id: {
          in: recoveredTaskIds,
        },
      },
      data: {
        status: TaskStatus.PENDING,
        executedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });

    this.logger.warn(
      `Recovered ${result.count} stale running task(s): ${recoveredTaskIds.join(', ')}`,
    );

    return result.count;
  }

  async acquireNextTaskLease(
    runnerId: string,
    leaseDurationMs: number,
  ): Promise<TaskWithFiles | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const candidates = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.PENDING,
        control: Role.ASSISTANT,
        OR: [
          { type: TaskType.IMMEDIATE },
          {
            type: TaskType.SCHEDULED,
            scheduledFor: {
              lte: now,
            },
          },
        ],
      },
      include: {
        files: true,
      },
    });

    for (const candidate of this.sortTasksForExecution(candidates)) {
      const acquisitionResult = await this.prisma.task.updateMany({
        where: {
          id: candidate.id,
          status: TaskStatus.PENDING,
          control: Role.ASSISTANT,
          OR: [
            {
              leaseOwner: null,
            },
            {
              leaseExpiresAt: null,
            },
            {
              leaseExpiresAt: {
                lte: now,
              },
            },
          ],
        },
        data: {
          status: TaskStatus.RUNNING,
          executedAt: now,
          leaseOwner: runnerId,
          leaseExpiresAt,
          heartbeatAt: now,
          runAttemptCount: {
            increment: 1,
          },
          ...(candidate.type === TaskType.SCHEDULED && candidate.queuedAt === null
            ? { queuedAt: now }
            : {}),
        },
      });

      if (acquisitionResult.count !== 1) {
        continue;
      }

      const leasedTask = await this.prisma.task.findUnique({
        where: { id: candidate.id },
        include: {
          files: true,
        },
      });

      if (!leasedTask) {
        return null;
      }

      this.logger.log(
        `Runner ${runnerId} acquired lease for task ${leasedTask.id} until ${leaseExpiresAt.toISOString()}`,
      );

      this.tasksGateway.emitTaskUpdate(leasedTask.id, leasedTask);
      return leasedTask;
    }

    return null;
  }

  async renewTaskLease(
    taskId: string,
    runnerId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const result = await this.prisma.task.updateMany({
      where: {
        id: taskId,
        status: TaskStatus.RUNNING,
        control: Role.ASSISTANT,
        leaseOwner: runnerId,
      },
      data: {
        leaseExpiresAt,
        heartbeatAt: now,
      },
    });

    return result.count === 1;
  }

  async requeueWithModel(
    taskId: string,
    model: Prisma.InputJsonValue,
  ): Promise<Task> {
    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.PENDING,
        model,
        executedAt: null,
        completedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        queuedAt: new Date(),
        error: null,
      },
    });

    this.logger.warn(
      `Task ${taskId} re-queued automatically with fallback model ${JSON.stringify(model)}`,
    );
    this.tasksGateway.emitTaskUpdate(taskId, updatedTask);

    return updatedTask;
  }

  async getOperationalMetrics(now = new Date()) {
    const [
      pending,
      running,
      needsHelp,
      needsReview,
      dueScheduled,
      futureScheduled,
      staleRunning,
    ] = await Promise.all([
      this.prisma.task.count({
        where: {
          status: TaskStatus.PENDING,
        },
      }),
      this.prisma.task.count({
        where: {
          status: TaskStatus.RUNNING,
        },
      }),
      this.prisma.task.count({
        where: {
          status: TaskStatus.NEEDS_HELP,
        },
      }),
      this.prisma.task.count({
        where: {
          status: TaskStatus.NEEDS_REVIEW,
        },
      }),
      this.prisma.task.count({
        where: {
          status: TaskStatus.PENDING,
          type: TaskType.SCHEDULED,
          scheduledFor: {
            lte: now,
          },
        },
      }),
      this.prisma.task.count({
        where: {
          status: TaskStatus.PENDING,
          type: TaskType.SCHEDULED,
          scheduledFor: {
            gt: now,
          },
        },
      }),
      this.prisma.task.count({
        where: {
          status: TaskStatus.RUNNING,
          OR: [
            {
              leaseExpiresAt: {
                lte: now,
              },
            },
            {
              leaseOwner: null,
            },
          ],
        },
      }),
    ]);

    return {
      pending,
      running,
      needsHelp,
      needsReview,
      dueScheduled,
      futureScheduled,
      staleRunning,
    };
  }

  async findAll(
    page = 1,
    limit = 10,
    statuses?: string[],
  ): Promise<{ tasks: Task[]; total: number; totalPages: number }> {
    this.logger.log(
      `Retrieving tasks - page: ${page}, limit: ${limit}, statuses: ${statuses?.join(',')}`,
    );

    const skip = (page - 1) * limit;

    const whereClause: Prisma.TaskWhereInput =
      statuses && statuses.length > 0
        ? { status: { in: statuses as TaskStatus[] } }
        : {};

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);
    this.logger.debug(`Retrieved ${tasks.length} tasks out of ${total} total`);

    return { tasks, total, totalPages };
  }

  async findById(id: string): Promise<Task> {
    this.logger.log(`Retrieving task by ID: ${id}`);

    try {
      const task = await this.prisma.task.findUnique({
        where: { id },
        include: {
          files: true,
        },
      });

      if (!task) {
        this.logger.warn(`Task with ID: ${id} not found`);
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      this.logger.debug(`Retrieved task with ID: ${id}`);
      return task;
    } catch (error: any) {
      this.logger.error(`Error retrieving task ID: ${id} - ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    this.logger.log(`Updating task with ID: ${id}`);
    this.logger.debug(`Update data: ${JSON.stringify(updateTaskDto)}`);

    const existingTask = await this.findById(id);

    if (!existingTask) {
      this.logger.warn(`Task with ID: ${id} not found for update`);
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    const { result, ...taskUpdateFields } = updateTaskDto;
    const updateData: Prisma.TaskUpdateInput = {
      ...taskUpdateFields,
      ...(result !== undefined
        ? { result: result as Prisma.InputJsonValue }
        : {}),
      ...(updateTaskDto.status && updateTaskDto.status !== TaskStatus.RUNNING
        ? {
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
          }
        : {}),
    };

    let updatedTask = await this.prisma.task.update({
      where: { id },
      data: updateData,
    });

    if (updateTaskDto.status === TaskStatus.COMPLETED) {
      this.eventEmitter.emit('task.completed', { taskId: id });
    } else if (updateTaskDto.status === TaskStatus.NEEDS_HELP) {
      updatedTask = await this.takeOver(id);
    } else if (updateTaskDto.status === TaskStatus.FAILED) {
      this.eventEmitter.emit('task.failed', { taskId: id });
    }

    this.logger.log(`Successfully updated task ID: ${id}`);
    this.logger.debug(`Updated task: ${JSON.stringify(updatedTask)}`);

    this.tasksGateway.emitTaskUpdate(id, updatedTask);

    return updatedTask;
  }

  async delete(id: string): Promise<Task> {
    this.logger.log(`Deleting task with ID: ${id}`);

    const existingTask = await this.findById(id);

    if (
      existingTask.status === TaskStatus.RUNNING ||
      existingTask.control === Role.USER
    ) {
      this.eventEmitter.emit('task.cancel', { taskId: id });
    }

    const deletedTask = await this.prisma.task.delete({
      where: { id },
    });

    this.logger.log(`Successfully deleted task ID: ${id}`);

    this.tasksGateway.emitTaskDeleted(id);

    return deletedTask;
  }

  async addTaskMessage(taskId: string, addTaskMessageDto: AddTaskMessageDto) {
    const task = await this.findById(taskId);
    if (!task) {
      this.logger.warn(`Task with ID: ${taskId} not found for guiding`);
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const message = await this.prisma.message.create({
      data: {
        content: [{ type: 'text', text: addTaskMessageDto.message }],
        role: Role.USER,
        taskId,
      },
    });

    this.tasksGateway.emitNewMessage(taskId, message);
    return task;
  }

  async resume(taskId: string): Promise<Task> {
    this.logger.log(`Resuming task ID: ${taskId}`);

    const task = await this.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (task.control !== Role.USER) {
      throw new BadRequestException(`Task ${taskId} is not under user control`);
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        control: Role.ASSISTANT,
        status: TaskStatus.PENDING,
        queuedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });

    try {
      await fetch(
        `${this.configService.get<string>('BYTEBOT_DESKTOP_BASE_URL')}/input-tracking/stop`,
        { method: 'POST' },
      );
    } catch (error) {
      this.logger.error('Failed to stop input tracking', error);
    }

    // Broadcast resume event so AgentProcessor can react
    this.eventEmitter.emit('task.resume', { taskId });

    this.logger.log(`Task ${taskId} resumed`);
    this.tasksGateway.emitTaskUpdate(taskId, updatedTask);

    return updatedTask;
  }

  async takeOver(taskId: string): Promise<Task> {
    this.logger.log(`Taking over control for task ID: ${taskId}`);

    const task = await this.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (task.control !== Role.ASSISTANT) {
      throw new BadRequestException(
        `Task ${taskId} is not under agent control`,
      );
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        control: Role.USER,
      },
    });

    try {
      await fetch(
        `${this.configService.get<string>('BYTEBOT_DESKTOP_BASE_URL')}/input-tracking/start`,
        { method: 'POST' },
      );
    } catch (error) {
      this.logger.error('Failed to start input tracking', error);
    }

    // Broadcast takeover event so AgentProcessor can react
    this.eventEmitter.emit('task.takeover', { taskId });

    this.logger.log(`Task ${taskId} takeover initiated`);
    this.tasksGateway.emitTaskUpdate(taskId, updatedTask);

    return updatedTask;
  }

  async cancel(taskId: string): Promise<Task> {
    this.logger.log(`Cancelling task ID: ${taskId}`);

    const task = await this.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Task ${taskId} is already completed, failed, or cancelled`,
      );
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.CANCELLED,
      },
    });

    // Broadcast cancel event so AgentProcessor can cancel processing
    this.eventEmitter.emit('task.cancel', { taskId });

    this.logger.log(`Task ${taskId} cancelled`);
    this.tasksGateway.emitTaskUpdate(taskId, updatedTask);

    return updatedTask;
  }
}
