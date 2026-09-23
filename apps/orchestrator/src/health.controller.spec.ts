// DesignerPRO regression coverage for publication-worker health reporting.
import { HealthController } from '@gitroom/orchestrator/health.controller';
import { Connection } from '@temporalio/client';

jest.mock('@temporalio/client', () => ({
  Connection: {
    connect: jest.fn(),
  },
}));

const response = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe('HealthController', () => {
  const close = jest.fn().mockResolvedValue(undefined);
  const describeNamespace = jest.fn().mockResolvedValue({});

  beforeEach(() => {
    jest.clearAllMocks();
    (Connection.connect as jest.Mock).mockResolvedValue({
      workflowService: { describeNamespace },
      close,
    });
  });

  it('reports healthy only when the WordPress worker and all workers are running', async () => {
    const getAllWorkers = jest.fn().mockReturnValue({
      workers: new Map([['wordpress', { isHealthy: true }]]),
      totalWorkers: 3,
      runningWorkers: 3,
      healthyWorkers: 3,
    });
    const controller = new HealthController({
      getWorkerManager: () => ({ getAllWorkers }),
    } as any);
    const res = response();

    await controller.getHealthStatus(res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'ok',
      workers: { total: 3, running: 3, healthy: 3, wordpress: true },
    });
    expect(close).toHaveBeenCalled();
  });

  it('reports degraded when Temporal is up but publication workers are absent', async () => {
    const getAllWorkers = jest.fn().mockReturnValue({
      workers: new Map(),
      totalWorkers: 0,
      runningWorkers: 0,
      healthyWorkers: 0,
    });
    const controller = new HealthController({
      getWorkerManager: () => ({ getAllWorkers }),
    } as any);
    const res = response();

    await controller.getHealthStatus(res as any);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      reason: 'workers_unavailable',
      workers: { total: 0, running: 0, healthy: 0, wordpress: false },
    });
    expect(close).toHaveBeenCalled();
  });
});
