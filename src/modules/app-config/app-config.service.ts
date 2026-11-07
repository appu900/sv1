import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AppConfig,
  AppConfigDocument,
} from '../../database/schemas/app-config.schema';
import {
  normaliseRules,
  RedesignFlags,
  RedesignRules,
  resolveRedesignFlags,
} from './redesign-flags';

const REDESIGN_KEY = 'redesign';
const CACHE_TTL_MS = 30_000;

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private cache: { rules: RedesignRules; version: number; at: number } | null = null;

  constructor(
    @InjectModel(AppConfig.name)
    private readonly appConfigModel: Model<AppConfigDocument>,
  ) {}

  /** Stored rollout rules, cached for 30 s per server instance. */
  async getRules(): Promise<{ rules: RedesignRules; version: number }> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return { rules: this.cache.rules, version: this.cache.version };
    }
    try {
      const doc = await this.appConfigModel
        .findOne({ key: REDESIGN_KEY })
        .lean();
      const rules = normaliseRules(doc?.rules as any);
      const version = doc?.version ?? 0;
      this.cache = { rules, version, at: now };
      return { rules, version };
    } catch (error) {
      // Never fail the app over switches: fall back to the last value, else all off.
      this.logger.error(`Could not load app config: ${(error as Error).message}`);
      return this.cache
        ? { rules: this.cache.rules, version: this.cache.version }
        : { rules: normaliseRules(null), version: 0 };
    }
  }

  /** The switches as plain booleans for one viewer. */
  async getFlags(viewer: {
    userId: string | null;
    appVersion: string | null;
  }): Promise<{ version: number; redesign: RedesignFlags }> {
    const { rules, version } = await this.getRules();
    return { version, redesign: resolveRedesignFlags(rules, viewer) };
  }

  /** Replaces the rules (admin). Invalid values are cleaned, not rejected. */
  async updateRules(
    input: unknown,
    updatedBy?: string,
  ): Promise<{ rules: RedesignRules; version: number }> {
    const rules = normaliseRules(input as any);
    const doc = await this.appConfigModel
      .findOneAndUpdate(
        { key: REDESIGN_KEY },
        { $set: { rules, updatedBy }, $inc: { version: 1 } },
        { new: true, upsert: true },
      )
      .lean();
    this.cache = null;
    return { rules: normaliseRules(doc?.rules as any), version: doc?.version ?? 1 };
  }
}
