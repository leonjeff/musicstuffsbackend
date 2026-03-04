import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private readonly config: ConfigService) {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: config.getOrThrow<string>('JWKS_URI'),
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: ['RS256'],
      issuer: config.getOrThrow<string>('OIDC_ISSUER'),
      audience: config.getOrThrow<string>('OIDC_AUDIENCE'),
    });
  }

  validate(payload: Record<string, unknown>): JwtPayload {
    const rolesClaim = this.config.get<string>(
      'AUTH0_ROLES_CLAIM',
      this.config.get<string>('OIDC_ROLES_CLAIM', 'roles'),
    );
    const roles = (payload[rolesClaim] as string[] | undefined) ?? [];
    const permissions =
      (payload['permissions'] as string[] | undefined) ??
      this.parseScopeClaim(payload['scope']);

    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(
        `Token valido: sub=${payload['sub']}, roles=[${roles.join(', ')}], permissions=[${permissions.join(', ')}]`,
      );
    }

    return {
      sub: payload['sub'] as string,
      email: payload['email'] as string | undefined,
      roles,
      permissions,
    };
  }

  private parseScopeClaim(scopeClaim: unknown): string[] {
    if (typeof scopeClaim !== 'string') return [];

    return scopeClaim
      .split(' ')
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
}
