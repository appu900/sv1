import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Resolves the JWT user when a token is present, but never rejects
 * unauthenticated requests. Controllers must treat `req.user` as optional.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(err: any, user: TUser): TUser | null {
    if (err || !user) {
      return null;
    }
    return user;
  }
}
