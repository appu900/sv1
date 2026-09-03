import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

/** JWT access token from login / OTP verify. Header: `Authorization: Bearer <token>`. */
export function ApiJwtAuth() {
  return applyDecorators(
    ApiBearerAuth('JWT'),
    ApiUnauthorizedResponse({
      description: 'Missing, expired, or invalid JWT access token.',
    }),
  );
}

/** JWT plus a role check (admin, chef, or user depending on the route). */
export function ApiJwtRoles(
  description = 'Authenticated user does not have the required role.',
) {
  return applyDecorators(
    ApiBearerAuth('JWT'),
    ApiUnauthorizedResponse({
      description: 'Missing, expired, or invalid JWT access token.',
    }),
    ApiForbiddenResponse({ description }),
  );
}

/** Optional JWT — send a Bearer token when the user is logged in for personalised results. */
export function ApiOptionalJwt() {
  return applyDecorators(ApiBearerAuth('JWT'));
}

/** Internal server-to-server key. Header: `x-admin-service-key`. */
export function ApiAdminServiceKeyAuth() {
  return applyDecorators(
    ApiSecurity('AdminServiceKey'),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid x-admin-service-key header.',
    }),
  );
}

/** Paid Saveful subscription required in addition to a valid JWT. */
export function ApiSubscription() {
  return applyDecorators(
    ApiBearerAuth('JWT'),
    ApiUnauthorizedResponse({
      description: 'Missing, expired, or invalid JWT access token.',
    }),
    ApiForbiddenResponse({
      description: 'Active Saveful subscription required.',
    }),
  );
}
