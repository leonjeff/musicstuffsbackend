import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(helmet());

  const configuredOrigins =
    process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? '*';
  const origins = configuredOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const corsOrigin = origins.length === 0 || origins.includes('*') ? '*' : origins;

  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Range',
      'Origin',
      'Accept',
      'Accept-Encoding',
    ],
    exposedHeaders: [
      'Content-Range',
      'Accept-Ranges',
      'Content-Length',
      'Content-Disposition',
      'Content-Type',
    ],
    credentials: corsOrigin !== '*',
    maxAge: 3600,
  });

  const videoBaseDir = process.env.VIDEO_BASE_DIR ?? '/tmp/music-stuffs/videos';
  const expressApp = app.getHttpAdapter().getInstance() as express.Application;

  expressApp.use(
    '/media',
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const requestOrigin = req.headers.origin;
      const mediaOrigin =
        corsOrigin === '*'
          ? '*'
          : requestOrigin && origins.includes(requestOrigin)
            ? requestOrigin
            : origins[0];

      res.setHeader('Access-Control-Allow-Origin', mediaOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Range, Origin, Accept, Accept-Encoding',
      );
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Range, Accept-Ranges, Content-Length, Content-Type',
      );
      if (mediaOrigin !== '*') res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    },
    express.static(videoBaseDir),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
