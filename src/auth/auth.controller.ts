import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';

const ROLE_REDIRECTS: Record<string, string> = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
};

function resolveRedirect(roles: string[]): string {
  for (const role of ['admin', 'teacher', 'student']) {
    if (roles.includes(role)) return ROLE_REDIRECTS[role];
  }
  return '/';
}

@Controller('auth')
export class AuthController {
  @Get('me')
  me(
    @CurrentUser()
    user: { sub: string; email?: string; roles: string[]; permissions: string[] },
  ) {
    return {
      id: user.sub,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      redirectTo: resolveRedirect(user.roles),
    };
  }
}
