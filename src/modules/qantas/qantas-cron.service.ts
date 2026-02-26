import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QantasService } from './qantas.service';


@Injectable()
export class QantasCronService {
  private readonly logger = new Logger(QantasCronService.name);

  constructor(private readonly qantasService: QantasService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processPendingAllocations(): Promise<void> {
    this.logger.log('Cron: Processing pending Qantas allocations…');
    try {
      await this.qantasService.processPendingAllocations();
    } catch (error) {
      this.logger.error('Cron processPendingAllocations failed', error);
    }
  }

  @Cron('0 2 * * *')
  async resetExpiredRewards(): Promise<void> {
    this.logger.log('Cron: Resetting rewards for expired Qantas memberships…');
    try {
      await this.qantasService.resetRewardsForExpiredMemberships();
    } catch (error) {
      this.logger.error('Cron resetExpiredRewards failed', error);
    }
  }
}
