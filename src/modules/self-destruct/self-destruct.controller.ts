import { Controller, Delete, Body, HttpCode, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as path from 'path';

@Controller('self-destruct')
export class SelfDestructController {
  private readonly logger = new Logger(SelfDestructController.name);

  constructor(private readonly configService: ConfigService) {}

  @Delete()
  @HttpCode(200)
  async nuke(@Body('pin') pin: string) {
    const correctPin = this.configService.get<string>('SELF_DESTRUCT_PIN');

    if (!correctPin) {
      throw new ForbiddenException('Self-destruct is not configured');
    }

    if (!pin || pin !== correctPin) {
      throw new ForbiddenException('Invalid PIN');
    }

    this.logger.warn('SELF-DESTRUCT initiated — wiping instance code...');

    const projectRoot = path.resolve(__dirname, '..', '..', '..');

    setTimeout(() => {
      try {
        const isWindows = process.platform === 'win32';
        if (isWindows) {
          execSync(`rd /s /q "${projectRoot}"`, { shell: 'cmd.exe' });
        } else {
          execSync(`rm -rf "${projectRoot}"`);
        }
      } catch (err) {
        this.logger.error('Self-destruct wipe failed', err);
      } finally {
        process.exit(0);
      }
    }, 1000);

    return { message: 'Self-destruct initiated. Instance will be wiped in seconds.' };
  }
}
