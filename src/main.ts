import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    transform:true,
    forbidNonWhitelisted:false,
    whitelist:true
  }))
  await app.listen(process.env.PORT ?? 3000);
  console.log(process.env.JWT_ACCESS_SECRET)
}
bootstrap();
