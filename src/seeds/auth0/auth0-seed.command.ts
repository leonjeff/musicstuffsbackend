import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Auth0SeedModule } from './auth0-seed.module';
import { Auth0SeedService } from './auth0-seed.service';

async function bootstrap() {
  const logger = new Logger('Auth0SeedCommand');
  const nodeEnv = process.env.NODE_ENV;
  const allowSeed = process.env.ALLOW_AUTH0_SEED;

  if (nodeEnv !== 'development') {
    logger.error(
      'Seed abortado: NODE_ENV debe ser exactamente development para ejecutar seed:auth0.',
    );
    process.exitCode = 1;
    return;
  }

  if (allowSeed !== 'true') {
    logger.error(
      'Seed abortado: ALLOW_AUTH0_SEED debe ser true para ejecutar seed:auth0.',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(Auth0SeedModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const auth0SeedService = app.get(Auth0SeedService);
    const args = process.argv.slice(2);
    const reset = args.includes('--reset');
    const updatePassword = args.includes('--update-password');

    logger.log(
      `Iniciando seed de Auth0${reset ? ' con --reset' : ''}${updatePassword ? ' con --update-password' : ''}...`,
    );

    await auth0SeedService.run({
      reset,
      updatePassword,
    });

    logger.log('Seed de Auth0 finalizado.');
  } catch (error) {
    logger.error(
      'El seed de Auth0 fallo',
      error instanceof Error ? error.stack : String(error),
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void bootstrap();
