import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { FastifyCorsOptions } from '@fastify/cors';
import { ValidationPipe } from '@nestjs/common';
import './instrument';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      ignoreTrailingSlash: true,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const corsOptions: FastifyCorsOptions = {
    origin: [
      'https://igra.top',
      'http://0.0.0.0:3000',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://0.0.0.0:4200',
      'http://localhost:4200',
      'http://127.0.0.1:4200',
      'http://0.0.0.0:5173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://imaginative-pie-56d32c.netlify.app',
      'null'
    ],
    credentials: true,
    methods: '*',
    allowedHeaders: ['*', 'Authorization', 'Content-Type'],
  };
  app.enableCors(corsOptions);

  const config = new DocumentBuilder()
    .setTitle('Mini games API')
    .setDescription('The mini games API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory);

  await app.listen(8080, '0.0.0.0');
}
bootstrap().catch(console.error);
