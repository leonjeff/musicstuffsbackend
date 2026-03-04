import {
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AssignPermissionsToRoleDto } from './dto/assign-permissions-to-role.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import {
  Auth0ManagementApiError,
  Auth0ManagementService,
} from './auth0-management.service';
import { UserProfile } from './entities/user-profile.entity';

interface Auth0User {
  user_id: string;
  email: string;
  name?: string;
  email_verified?: boolean;
  blocked?: boolean;
  created_at?: string;
  last_login?: string;
  logins_count?: number;
}

interface Auth0UsersResponse {
  users: Auth0User[];
  start: number;
  limit: number;
  total: number;
}

interface Auth0Role {
  id: string;
  name: string;
  description?: string;
}

interface Auth0RolePermission {
  permission_name: string;
  description?: string;
  resource_server_identifier: string;
  resource_server_name?: string;
}

interface Auth0ResourceServerScope {
  value: string;
  description?: string;
}

interface Auth0ResourceServer {
  id: string;
  name: string;
  identifier: string;
  scopes: Auth0ResourceServerScope[];
}

@Injectable()
export class AuthAdminService {
  private readonly logger = new Logger(AuthAdminService.name);
  private readonly apiIdentifier: string;

  constructor(
    private readonly auth0Management: Auth0ManagementService,
    private readonly config: ConfigService,
    @InjectRepository(UserProfile)
    private readonly userProfileRepo: Repository<UserProfile>,
  ) {
    this.apiIdentifier = this.config.getOrThrow<string>('AUTH0_API_IDENTIFIER');
  }

  async createUser(actor: JwtPayload, dto: CreateUserDto) {
    const createdUser = await this.auth0Management.request<Auth0User>(
      'POST',
      '/users',
      {
        email: dto.email,
        connection: dto.connection,
        name: dto.name,
        password: dto.password,
      },
    );

    if (dto.roleIds?.length) {
      await this.auth0Management.request<void>(
        'POST',
        `/users/${encodeURIComponent(createdUser.user_id)}/roles`,
        { roles: dto.roleIds },
      );
    }

    const roles = await this.getUserRoles(createdUser.user_id);
    const profile = await this.upsertUserProfile({
      auth0UserId: createdUser.user_id,
      email: createdUser.email,
      name: createdUser.name ?? dto.name ?? null,
      rolesCache: roles.map((role) => role.name),
    });

    this.logAudit(actor, 'admin.users.create', {
      targetUserId: createdUser.user_id,
      initialRoleIds: dto.roleIds ?? [],
    });

    return {
      user: this.mapUser(createdUser, profile),
      profile,
    };
  }

  async listUsers(actor: JwtPayload, query: ListUsersQueryDto) {
    const response = await this.auth0Management.request<Auth0UsersResponse>(
      'GET',
      '/users',
      undefined,
      {
        page: query.page,
        per_page: query.perPage,
        include_totals: true,
        search_engine: query.search ? 'v3' : undefined,
        q: query.search ? this.buildUserSearchQuery(query.search) : undefined,
      },
    );

    const auth0UserIds = response.users.map((user) => user.user_id);
    const profiles = auth0UserIds.length
      ? await this.userProfileRepo
          .createQueryBuilder('profile')
          .where('profile.auth0UserId IN (:...auth0UserIds)', { auth0UserIds })
          .getMany()
      : [];
    const profileMap = new Map(
      profiles.map((profile) => [profile.auth0UserId, profile]),
    );

    this.logAudit(actor, 'admin.users.list', {
      page: query.page,
      perPage: query.perPage,
      search: query.search ?? null,
    });

    return {
      page: query.page,
      perPage: query.perPage,
      total: response.total,
      users: response.users.map((user) =>
        this.mapUser(user, profileMap.get(user.user_id)),
      ),
    };
  }

  async assignRolesToUser(
    actor: JwtPayload,
    auth0UserId: string,
    dto: AssignRolesDto,
  ) {
    await this.auth0Management.request<void>(
      'POST',
      `/users/${encodeURIComponent(auth0UserId)}/roles`,
      { roles: dto.roleIds },
    );

    const [user, roles] = await Promise.all([
      this.getUser(auth0UserId),
      this.getUserRoles(auth0UserId),
    ]);
    const profile = await this.upsertUserProfile({
      auth0UserId,
      email: user.email,
      name: user.name ?? null,
      rolesCache: roles.map((role) => role.name),
    });

    this.logAudit(actor, 'admin.users.assign_roles', {
      targetUserId: auth0UserId,
      roleIds: dto.roleIds,
    });

    return {
      auth0UserId,
      roles: roles.map((role) => this.mapRole(role)),
      profile,
    };
  }

  async createRole(actor: JwtPayload, dto: CreateRoleDto) {
    const role = await this.auth0Management.request<Auth0Role>(
      'POST',
      '/roles',
      dto,
    );

    this.logAudit(actor, 'admin.roles.create', {
      roleId: role.id,
      roleName: role.name,
    });

    return this.mapRole(role);
  }

  async listRoles(actor: JwtPayload) {
    const roles = await this.auth0Management.request<Auth0Role[]>(
      'GET',
      '/roles',
      undefined,
      {
        per_page: 100,
      },
    );

    this.logAudit(actor, 'admin.roles.list', {});

    return roles.map((role) => this.mapRole(role));
  }

  async assignPermissionsToRole(
    actor: JwtPayload,
    roleId: string,
    dto: AssignPermissionsToRoleDto,
  ) {
    await this.auth0Management.request<void>(
      'POST',
      `/roles/${encodeURIComponent(roleId)}/permissions`,
      {
        permissions: dto.permissionNames.map((permissionName) => ({
          permission_name: permissionName,
          resource_server_identifier: this.apiIdentifier,
        })),
      },
    );

    const permissions = await this.auth0Management.request<Auth0RolePermission[]>(
      'GET',
      `/roles/${encodeURIComponent(roleId)}/permissions`,
      undefined,
      {
        per_page: 100,
      },
    );

    this.logAudit(actor, 'admin.roles.assign_permissions', {
      roleId,
      permissionNames: dto.permissionNames,
    });

    return {
      roleId,
      permissions: permissions
        .filter(
          (permission) =>
            permission.resource_server_identifier === this.apiIdentifier,
        )
        .map((permission) => this.mapRolePermission(permission)),
    };
  }

  async createPermission(actor: JwtPayload, dto: CreatePermissionDto) {
    const resourceServer = await this.getResourceServer();
    const existingScope = resourceServer.scopes.find(
      (scope) => scope.value === dto.value,
    );

    if (existingScope) {
      this.logAudit(actor, 'admin.permissions.create.noop', {
        permission: dto.value,
      });

      return {
        created: false,
        permission: this.mapScope(existingScope),
      };
    }

    try {
      await this.auth0Management.request<Auth0ResourceServer>(
        'PATCH',
        `/resource-servers/${encodeURIComponent(resourceServer.id)}`,
        {
          scopes: [
            ...resourceServer.scopes,
            {
              value: dto.value,
              description: dto.description ?? '',
            },
          ],
        },
      );
    } catch (error) {
      if (
        error instanceof Auth0ManagementApiError &&
        [403, 404, 405, 501].includes(error.statusCode)
      ) {
        throw new NotImplementedException(
          'Este tenant no permite crear scopes por Management API. Configuralos en Auth0 Dashboard y usa GET /admin/permissions para sincronizar.',
        );
      }
      throw error;
    }

    this.logAudit(actor, 'admin.permissions.create', {
      permission: dto.value,
    });

    return {
      created: true,
      permission: this.mapScope({
        value: dto.value,
        description: dto.description ?? '',
      }),
    };
  }

  async listPermissions(actor: JwtPayload) {
    const resourceServer = await this.getResourceServer();

    this.logAudit(actor, 'admin.permissions.list', {});

    return {
      apiIdentifier: resourceServer.identifier,
      resourceServerId: resourceServer.id,
      resourceServerName: resourceServer.name,
      permissions: resourceServer.scopes.map((scope) => this.mapScope(scope)),
    };
  }

  private async getUser(auth0UserId: string): Promise<Auth0User> {
    return this.auth0Management.request<Auth0User>(
      'GET',
      `/users/${encodeURIComponent(auth0UserId)}`,
    );
  }

  private async getUserRoles(auth0UserId: string): Promise<Auth0Role[]> {
    return this.auth0Management.request<Auth0Role[]>(
      'GET',
      `/users/${encodeURIComponent(auth0UserId)}/roles`,
      undefined,
      {
        per_page: 100,
      },
    );
  }

  private async getResourceServer(): Promise<Auth0ResourceServer> {
    const resourceServers = await this.auth0Management.request<Auth0ResourceServer[]>(
      'GET',
      '/resource-servers',
      undefined,
      {
        per_page: 100,
      },
    );
    const resourceServer = resourceServers.find(
      (candidate) => candidate.identifier === this.apiIdentifier,
    );

    if (!resourceServer) {
      throw new NotFoundException(
        `No existe un Resource Server en Auth0 con identifier ${this.apiIdentifier}`,
      );
    }

    return resourceServer;
  }

  private async upsertUserProfile(input: {
    auth0UserId: string;
    email: string;
    name: string | null;
    rolesCache: string[];
  }): Promise<UserProfile> {
    const existing = await this.userProfileRepo.findOneBy({
      auth0UserId: input.auth0UserId,
    });

    if (existing) {
      existing.email = input.email;
      existing.name = input.name;
      existing.rolesCache = input.rolesCache;
      return this.userProfileRepo.save(existing);
    }

    return this.userProfileRepo.save(
      this.userProfileRepo.create({
        auth0UserId: input.auth0UserId,
        email: input.email,
        name: input.name,
        rolesCache: input.rolesCache,
      }),
    );
  }

  private buildUserSearchQuery(search: string): string {
    const sanitized = search.trim().replace(/[\\"]/g, '\\$&');
    return `email:*${sanitized}* OR name:*${sanitized}*`;
  }

  private mapUser(user: Auth0User, profile?: UserProfile) {
    return {
      auth0UserId: user.user_id,
      email: user.email,
      name: user.name ?? profile?.name ?? null,
      emailVerified: user.email_verified ?? false,
      blocked: user.blocked ?? false,
      loginsCount: user.logins_count ?? 0,
      lastLogin: user.last_login ?? null,
      auth0CreatedAt: user.created_at ?? null,
      roles: profile?.rolesCache ?? [],
      profileId: profile?.id ?? null,
      profileUpdatedAt: profile?.updatedAt ?? null,
    };
  }

  private mapRole(role: Auth0Role) {
    return {
      id: role.id,
      name: role.name,
      description: role.description ?? null,
    };
  }

  private mapRolePermission(permission: Auth0RolePermission) {
    return {
      permissionName: permission.permission_name,
      description: permission.description ?? null,
      resourceServerIdentifier: permission.resource_server_identifier,
      resourceServerName: permission.resource_server_name ?? null,
    };
  }

  private mapScope(scope: Auth0ResourceServerScope) {
    return {
      value: scope.value,
      description: scope.description ?? null,
    };
  }

  private logAudit(
    actor: JwtPayload,
    action: string,
    metadata: Record<string, unknown>,
  ): void {
    this.logger.log(
      JSON.stringify({
        action,
        actor: actor.sub,
        roles: actor.roles,
        metadata,
      }),
    );
  }
}
