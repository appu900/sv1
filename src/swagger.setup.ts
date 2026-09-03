import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const API_DESCRIPTION = `
# Saveful Backend API

Interactive OpenAPI 3 documentation for the Saveful NestJS backend.

**Production host:** [https://backend.saveful.app](https://backend.saveful.app)  
**API prefix:** all HTTP routes are served under \`/api\` (for example \`POST /api/auth/login\`).

## Authentication

| Scheme | How to send it | Used by |
| --- | --- | --- |
| **JWT** | \`Authorization: Bearer <accessToken>\` | Most authenticated app, chef, and admin routes |
| **Admin service key** | \`x-admin-service-key: <ADMIN_SERVICE_KEY>\` | Internal notification dispatch |
| **RevenueCat webhook** | \`Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>\` | \`POST /api/webhook/revenuecat\` |
| **Stripe webhook** | Stripe-Signature header (raw JSON body) | \`POST /api/perks/billing/webhook\` |

Obtain a JWT from:

- \`POST /api/auth/login\` — email + password
- \`POST /api/auth/verify-otp\` — email OTP
- \`POST /api/auth/admin/login\` — admin
- \`POST /api/auth/chef/login\` — chef
- \`POST /api/auth/refresh\` — refresh token

Click **Authorize** in this UI, paste the access token, and Try it out will send the Bearer header.

## Roles

Guarded routes may require one of: \`user\`, \`chef\`, \`admin\`. Insufficient role returns **403**.

## Notes

- Some recipe / cuisine / framework-category routes are mounted at \`/api/api/...\` because those controllers include an extra \`api/\` prefix. That is the live path.
- Multipart endpoints accept \`multipart/form-data\` (images plus fields).
- Nutrition and meal-plan routes require an **active subscription**.
- Webhook endpoints are for providers, not the mobile app.
`;

const swaggerUiOptions = {
  customSiteTitle: 'Saveful API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
    docExpansion: 'none',
    filter: true,
    tryItOutEnabled: true,
    displayRequestDuration: true,
    showExtensions: true,
    showCommonExtensions: true,
  },
};

export function setupSwagger(app: INestApplication): void {
  const localPort = process.env.PORT ?? 3000;
  const isProd = process.env.NODE_ENV === 'production';

  const builder = new DocumentBuilder()
    .setTitle('Saveful API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0.0')
    .setContact('Saveful', 'https://saveful.app', 'hello@saveful.app');

  if (isProd) {
    builder
      .addServer('https://backend.saveful.app', 'Production')
      .addServer(`http://localhost:${localPort}`, 'Local');
  } else {
    builder
      .addServer(`http://localhost:${localPort}`, 'Local')
      .addServer('https://backend.saveful.app', 'Production');
  }

  const config = builder
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'JWT access token from login or OTP verify. Example: Bearer eyJhbGciOi...',
      },
      'JWT',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-admin-service-key',
        description: 'Internal admin service key (ADMIN_SERVICE_KEY).',
      },
      'AdminServiceKey',
    )
    .addTag('Health', 'Process health and hello checks.')
    .addTag('Auth', 'OTP, signup, login, refresh, profile, password, and account.')
    .addTag('User', 'Authenticated user profile, timezone, and marketing preference.')
    .addTag('Admin', 'Admin chef/user management and dashboard analytics.')
    .addTag('Recipes', 'Recipe catalogue, summaries, scaling, and dietary recommendations.')
    .addTag('Cookbook AI', 'User cookbook recipes and AI generation from ingredients.')
    .addTag('Shared Recipes', 'Share recipes into communities, like, and save.')
    .addTag('Chefs', 'Public chef directory, recipes, favourites, and community impact.')
    .addTag('Chef Profiles', 'Chef profile CRUD and impact recompute.')
    .addTag('Ingredients', 'Ingredient catalogue and categories.')
    .addTag('Cuisines', 'Cuisine catalogue.')
    .addTag('Diets', 'Dietary tags used across recipes and onboarding.')
    .addTag('Framework Categories', 'Recipe framework categories.')
    .addTag('Food Facts', 'Food fact cards.')
    .addTag('Hacks', 'Kitchen hack articles and categories.')
    .addTag('Hack or Tip', 'Short hack-or-tip cards shown in the app.')
    .addTag('Stickers', 'Sticker assets for the app.')
    .addTag('Sponsors', 'Sponsor records.')
    .addTag('Community Groups', 'Community groups, membership, and challenges.')
    .addTag('Favourites', 'User favourite recipes.')
    .addTag('Badges', 'Badge catalogue, awards, progress, and leaderboards.')
    .addTag('Analytics', 'Food-saved events, cooked recipes, leaderboard, and product metrics.')
    .addTag('Inventory', 'Kitchen inventory, expiry, leftover AI, and scan-to-add.')
    .addTag('Shopping List', 'Personal shopping list CRUD and recipe import.')
    .addTag('Nutrition', 'Food logging, custom foods, barcode, photo AI, and health profile.')
    .addTag('Meal Plan', 'Subscription meal plans generated from inventory and preferences.')
    .addTag('Promos', 'In-app promo cards (audience-targeted).')
    .addTag('Perks', 'Perks membership, catalogue, cart, wallet, and calculator.')
    .addTag('Perks Billing', 'Stripe checkout, customer portal, and webhooks.')
    .addTag('Qantas', 'Qantas Frequent Flyer linking and dashboard.')
    .addTag('Notifications', 'Device tokens, send, dispatch, and queue admin.')
    .addTag('Subscription', 'RevenueCat subscription snapshot, sync, and admin revoke.')
    .addTag('Webhooks', 'Provider webhooks (RevenueCat).')
    .addTag('Survey', 'Weekly track survey eligibility and responses.')
    .addTag('Survey Config', 'Admin survey question configuration.')
    .addTag('Feedback', 'Recipe feedback from users and admin review.')
    .addTag('User Events', 'Product analytics events, recipe views, and feature usage.')
    .addTag('AI Events', 'AI interaction user-action and admin summary.')
    .addTag('Data Version', 'Tiny collection-version manifest for client cache invalidation.')
    .addTag('Deeplink', 'Universal-link redirects into the mobile app.')
    .addTag('Cache', 'Redis cache health and manual ingredient-cache flush.')
    .addTag('SQS', 'SQS publish helper.')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey}_${methodKey}`,
  });

  SwaggerModule.setup('api-docs', app, document, {
    ...swaggerUiOptions,
    jsonDocumentUrl: 'api-docs-json',
    yamlDocumentUrl: 'api-docs-yaml',
  });

  // Same docs under the /api prefix so https://backend.saveful.app/api/api-docs works too.
  SwaggerModule.setup('api/api-docs', app, document, {
    ...swaggerUiOptions,
    jsonDocumentUrl: 'api/api-docs-json',
    yamlDocumentUrl: 'api/api-docs-yaml',
  });
}
