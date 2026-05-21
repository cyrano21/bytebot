import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { AgentProcessor } from './agent/agent.processor';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly agentProcessor: AgentProcessor,
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

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'bytebot-agent',
      timestamp: new Date().toISOString(),
      database,
      agent: {
        isProcessing: this.agentProcessor.isRunning(),
        currentTaskId: this.agentProcessor.getCurrentTaskId(),
      },
      config: {
        desktopBaseUrlConfigured: Boolean(process.env.BYTEBOT_DESKTOP_BASE_URL),
        proxyUrlConfigured: Boolean(process.env.BYTEBOT_LLM_PROXY_URL),
      },
    };
  }
}
