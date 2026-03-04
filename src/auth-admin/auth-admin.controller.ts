import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AllowDevBypassAdmin } from '../auth/decorators/dev-bypass-admin.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthAdminService } from './auth-admin.service';
import { AssignPermissionsToRoleDto } from './dto/assign-permissions-to-role.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

@Controller('admin')
@Roles('admin')
@AllowDevBypassAdmin()
export class AuthAdminController {
  constructor(private readonly authAdminService: AuthAdminService) {}

  @Post('users')
  createUser(@CurrentUser() actor: JwtPayload, @Body() dto: CreateUserDto) {
    return this.authAdminService.createUser(actor, dto);
  }

  @Get('users')
  listUsers(
    @CurrentUser() actor: JwtPayload,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.authAdminService.listUsers(actor, query);
  }

  @Post('users/:auth0UserId/roles')
  assignRolesToUser(
    @CurrentUser() actor: JwtPayload,
    @Param('auth0UserId') auth0UserId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.authAdminService.assignRolesToUser(actor, auth0UserId, dto);
  }

  @Post('roles')
  createRole(@CurrentUser() actor: JwtPayload, @Body() dto: CreateRoleDto) {
    return this.authAdminService.createRole(actor, dto);
  }

  @Get('roles')
  listRoles(@CurrentUser() actor: JwtPayload) {
    return this.authAdminService.listRoles(actor);
  }

  @Post('roles/:roleId/permissions')
  assignPermissionsToRole(
    @CurrentUser() actor: JwtPayload,
    @Param('roleId') roleId: string,
    @Body() dto: AssignPermissionsToRoleDto,
  ) {
    return this.authAdminService.assignPermissionsToRole(actor, roleId, dto);
  }

  @Post('permissions')
  createPermission(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CreatePermissionDto,
  ) {
    return this.authAdminService.createPermission(actor, dto);
  }

  @Get('permissions')
  listPermissions(@CurrentUser() actor: JwtPayload) {
    return this.authAdminService.listPermissions(actor);
  }
}
