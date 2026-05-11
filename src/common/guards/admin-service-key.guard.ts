import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AdminServiceKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const serviceKey = process.env.ADMIN_SERVICE_KEY;
    if (!serviceKey) {
      throw new UnauthorizedException('Service key not configured');
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-admin-service-key'];

    if (!provided || provided !== serviceKey) {
      throw new UnauthorizedException('Invalid or missing service key');
    }

    return true;
  }
}
