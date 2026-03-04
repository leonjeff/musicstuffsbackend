import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { DEV_BYPASS_ADMIN_KEY } from '../decorators/dev-bypass-admin.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    if (this.shouldBypassAdmin(context)) {
      const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
      request.user = {
        sub: 'dev-bypass-admin',
        roles: ['admin'],
        permissions: ['*'],
      };

      this.logger.warn(
        'DEV_BYPASS_ADMIN=true en desarrollo: acceso admin concedido sin JWT',
      );

      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<T>(err: Error | null, user: T, info: { message?: string }): T {
    if (err || !user) {
      const reason = err?.message ?? info?.message ?? 'unknown';
      this.logger.warn(`Token invalido o ausente: ${reason}`);
      throw new UnauthorizedException('Token invalido o ausente');
    }
    return user;
  }

  private shouldBypassAdmin(context: ExecutionContext): boolean {
    const canBypass = this.reflector.getAllAndOverride<boolean>(
      DEV_BYPASS_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!canBypass) return false;

    if (process.env.NODE_ENV === 'production') {
      if (process.env.DEV_BYPASS_ADMIN === 'true') {
        this.logger.error(
          'DEV_BYPASS_ADMIN=true fue ignorado porque NODE_ENV=production',
        );
      }
      return false;
    }

    if (process.env.DEV_BYPASS_ADMIN !== 'true') return false;

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();

    return !request.headers?.authorization;
  }
}
