import './instrumentation';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import { setupSwagger } from './swagger.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

 
  app.use(compression({ threshold: 1024, level: 6 }));

  // Stripe signs the raw request body, so this must be parsed as a Buffer and
  // must be mounted BEFORE the JSON parser below — otherwise the body is
  // already consumed and every webhook signature check fails.
  app.use(
    '/api/perks/billing/webhook',
    bodyParser.raw({ type: 'application/json' }),
  );

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.setGlobalPrefix('api');
app.enableCors({
  origin: (origin, callback) => {

    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://admin.saveful.app',
      'https://saveful.app',
    ];

    // Allow expo dev
    if (origin.startsWith('exp://') || origin.startsWith('http://192.168.') || origin.startsWith('http://10.')) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
});

  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    forbidNonWhitelisted: false,
    whitelist: true
  }));

  setupSwagger(app);

  app.use((req, res, next) => {
    logger.log(`Request: ${req.method} ${req.url}`, {
      method: req.method,
      path: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    next();
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: http://0.0.0.0:${port}`);
  logger.log(`OpenAPI docs: http://0.0.0.0:${port}/api-docs`);
}
bootstrap();