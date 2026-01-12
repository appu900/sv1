import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import './instrumentation';
import { WinstonModule } from 'nest-winston';
import createWinstonLogger from './logger';
async function bootstrap() {
  const logger = createWinstonLogger();
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      instance: logger,
    }),
  });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: ['http://localhost:3001', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    forbidNonWhitelisted: false,
    whitelist: true
  }))
  app.use((req, res, next) => {
    logger.info(`Request: ${req.method} ${req.url}`, {
      method: req.method,
      path: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    next();
  });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  logger.info(`Application is running on: http://0.0.0.0:${process.env.PORT ?? 3000}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Redis running on remote server: ${process.env.REDIS_URL}`);
}
bootstrap();
