import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationMaintenanceService {
  constructor(private readonly notifications: NotificationService) {}

  @Interval(60_000)
  async requeueOrphans() {
    await this.notifications.requeueOrphaned();
  }
}
