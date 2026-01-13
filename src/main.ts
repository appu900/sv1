import './instrumentation';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get the logger from the module
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: ['http://localhost:3001', 'http://localhost:3000','https://crm.saveful.devsomeware.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    forbidNonWhitelisted: false,
    whitelist: true
  }));

  app.use((req, res, next) => {
    logger.log(`Request: ${req.method} ${req.url}`, {
      method: req.method,
      path: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    next();
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  logger.log(`Application is running on: http://0.0.0.0:${process.env.PORT ?? 3000}`);
}
bootstrap();