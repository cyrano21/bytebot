import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { AgentProcessor } from './agent/agent.processor';
import { AgentScheduler } from './agent/agent.scheduler';
import { getAvailableModels, getDefaultModel } from './models/available-models';
import { TasksService } from './tasks/tasks.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly agentProcessor: AgentProcessor,
    private readonly agentScheduler: AgentScheduler,
    private readonly tasksService: TasksService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    let database = 'up';

    try {
      await this.prismaService.$queryRawUnsafe('SELECT 1');
    } catch {
      database = 'down';
    }

    const availableModels = await getAvailableModels();
    const defaultModel = await getDefaultModel();
    const queue = await this.tasksService.getOperationalMetrics();

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'bytebot-agent',
      timestamp: new Date().toISOString(),
      database,
      agent: {
        isProcessing: this.agentProcessor.isRunning(),
        currentTaskId: this.agentProcessor.getCurrentTaskId(),
        runnerId: this.agentScheduler.getRunnerId(),
        leaseDurationMs: this.agentScheduler.getLeaseDurationMs(),
      },
      models: {
        count: availableModels.length,
        defaultModel,
      },
      queue,
      config: {
        desktopBaseUrlConfigured: Boolean(process.env.BYTEBOT_DESKTOP_BASE_URL),
        proxyUrlConfigured: Boolean(process.env.BYTEBOT_LLM_PROXY_URL),
      },
    };
  }
}
