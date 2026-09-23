// DesignerPRO modification: health requires active publication workers, not
// merely a reachable Temporal server.
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Connection } from '@temporalio/client';
import { TemporalService } from 'nestjs-temporal-core';

@Controller('health')
export class HealthController {
  constructor(private readonly temporalService: TemporalService) {}

  @Get('/status')
  async getHealthStatus(@Res() res: Response) {
    let connection: Connection | undefined;
    try {
      const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
      connection = await Connection.connect({
        address,
        ...(process.env.TEMPORAL_TLS === 'true' ? { tls: true } : {}),
        ...(process.env.TEMPORAL_API_KEY
          ? { apiKey: process.env.TEMPORAL_API_KEY }
          : {}),
      });

      const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
      await Promise.race([
        connection.workflowService.describeNamespace({ namespace }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10000)
        ),
      ]);

      const workers = this.temporalService
        .getWorkerManager()
        .getAllWorkers();
      const wordpress = workers.workers.get('wordpress');
      const allWorkersHealthy =
        workers.totalWorkers > 0 &&
        workers.runningWorkers === workers.totalWorkers &&
        workers.healthyWorkers === workers.totalWorkers;

      if (!allWorkersHealthy || !wordpress?.isHealthy) {
        return res.status(503).json({
          status: 'error',
          reason: 'workers_unavailable',
          workers: {
            total: workers.totalWorkers,
            running: workers.runningWorkers,
            healthy: workers.healthyWorkers,
            wordpress: wordpress?.isHealthy === true,
          },
        });
      }

      return res.status(200).json({
        status: 'ok',
        workers: {
          total: workers.totalWorkers,
          running: workers.runningWorkers,
          healthy: workers.healthyWorkers,
          wordpress: true,
        },
      });
    } catch {
      return res.status(500).json({ status: 'error' });
    } finally {
      await connection?.close().catch(() => {});
    }
  }
}
