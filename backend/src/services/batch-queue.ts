export const BATCH_PROCESSING_QUEUE_NAME = "batch-processing-queue";

export interface BatchProcessingJobData {
  brandAddress: string;
  batchId: string;
  serialNumbers: string[];
  warrantyMonths: number;
}

export interface BatchQueueConnectionOptions {
  host: string;
  port: number;
  password?: string;
}

export class BatchProcessingQueueConfig {
  readonly queueName = BATCH_PROCESSING_QUEUE_NAME;
  readonly connection: BatchQueueConnectionOptions;

  constructor(connection?: Partial<BatchQueueConnectionOptions>) {
    this.connection = {
      host: connection?.host ?? process.env.REDIS_HOST ?? "127.0.0.1",
      port: connection?.port ?? Number(process.env.REDIS_PORT ?? 6379),
      password: connection?.password ?? process.env.REDIS_PASSWORD,
    };
  }
}
