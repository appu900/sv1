import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationService } from './notification.service';
import { ORPHAN_REQUEUE_INTERVAL_MS } from './constants';

@Injectable()
export class NotificationMaintenanceService implements OnModuleInit {
  constructor(private readonly notifications: NotificationService) {}

  async onModuleInit() {
    // Do not wait for the first interval — after a deploy, queued admin
    // pushes should leave as soon as Mongo/Redis are up.
    setTimeout(() => {
      void this.notifications.requeueOrphaned();
    }, 2_000);
  }

  @Interval(ORPHAN_REQUEUE_INTERVAL_MS)
  async requeueOrphans() {
    await this.notifications.requeueOrphaned();
  }
}
