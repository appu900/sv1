import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FeatureKey,
  SubscriptionPlan,
} from './subscription.constants';
import { SubscriptionService } from './subscription.service';

export const REQUIRE_FEATURE_KEY = 'subscription:require_feature';
export const REQUIRE_PLAN_KEY = 'subscription:require_plan';

export const RequireFeature = (feature: FeatureKey) =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);

export const RequirePlan = (plan: Exclude<SubscriptionPlan, 'basic'>) =>
  SetMetadata(REQUIRE_PLAN_KEY, plan);

const PLAN_RANK: Record<SubscriptionPlan, number> = {
  basic: 0,
  hero: 1,
  legend: 2,
};

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const minPlan = this.reflector.getAllAndOverride<SubscriptionPlan | undefined>(
      REQUIRE_PLAN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature && !minPlan) return true;

    const req = context.switchToHttp().getRequest();
    const userId = req.user?._id || req.user?.userId || req.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    if (feature) {
      await this.subscriptionService.assertFeature(userId, feature);
    }
    if (minPlan) {
      const plan = await this.subscriptionService.getPlan(userId);
      if (PLAN_RANK[plan] < PLAN_RANK[minPlan]) {
        throw new ForbiddenException({
          code: 'UPGRADE_REQUIRED',
          requiredPlan: minPlan,
          currentPlan: plan,
          message: `This feature requires the ${minPlan} plan.`,
        });
      }
    }
    return true;
  }
}
