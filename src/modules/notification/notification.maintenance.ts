import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationService } from './notification.service';
import { ORPHAN_REQUEUE_INTERVAL_MS } from './constants';

@Injectable()
export class NotificationMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(NotificationMaintenanceService.name);
  private running = false;

  constructor(private readonly notifications: NotificationService) {}

  onModuleInit() {
    setTimeout(() => {
      void this.runMaintenance();
    }, 2_000);
  }

  @Interval(ORPHAN_REQUEUE_INTERVAL_MS)
  async requeueOrphans() {
    await this.runMaintenance();
  }

  private async runMaintenance(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const [repaired, finalized, requeued] = await Promise.all([
        this.notifications.repairImpossibleCounters(),
        this.notifications.finalizeStaleProcessing(),
        this.notifications.requeueOrphaned(),
      ]);
      if (repaired > 0 || finalized > 0 || requeued > 0) {
        this.logger.warn(
          `Notification maintenance: repaired ${repaired}, finalized ${finalized}, requeued ${requeued}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Notification maintenance failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
