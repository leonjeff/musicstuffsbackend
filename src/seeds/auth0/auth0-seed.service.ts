import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Auth0ManagementService,
  Auth0ResourceServerScope,
  Auth0Role,
  Auth0User,
} from '../../auth-admin/auth0-management.service';
import { UserProfile } from '../../auth-admin/entities/user-profile.entity';

type SeedOptions = {
  reset: boolean;
  updatePassword: boolean;
};

type SeedRoleName = 'admin' | 'teacher' | 'student';

type SeedRoleDefinition = {
  name: SeedRoleName;
  description: string;
};

type SeedUserDefinition = {
  roleName: SeedRoleName;
  emailEnv: string;
  defaultEmail: string;
  displayName: string;
};

const PERMISSIONS: Auth0ResourceServerScope[] = [
  { value: 'courses:read', description: 'Read courses' },
  { value: 'courses:write', description: 'Create and update courses' },
  { value: 'lessons:read', description: 'Read lessons' },
  { value: 'lessons:write', description: 'Create and update lessons' },
  { value: 'videos:read', description: 'Read video metadata and streams' },
  { value: 'videos:write', description: 'Upload and manage videos' },
  { value: 'users:read', description: 'Read user administration data' },
  { value: 'users:write', description: 'Create and manage users' },
  { value: 'analytics:read', description: 'Read analytics' },
];

const ROLE_DEFINITIONS: SeedRoleDefinition[] = [
  { name: 'admin', description: 'Full administrative access' },
  { name: 'teacher', description: 'Course and content management access' },
  { name: 'student', description: 'Student learning access' },
];

const ROLE_PERMISSIONS: Record<SeedRoleName, string[]> = {
  admin: PERMISSIONS.map((permission) => permission.value),
  teacher: [
    'courses:read',
    'courses:write',
    'lessons:read',
    'lessons:write',
    'videos:read',
    'videos:write',
    'analytics:read',
  ],
  student: ['courses:read', 'lessons:read', 'videos:read'],
};

const USER_DEFINITIONS: SeedUserDefinition[] = [
  {
    roleName: 'admin',
    emailEnv: 'DEMO_ADMIN_EMAIL',
    defaultEmail: 'admin@demo.local',
    displayName: 'Demo Admin',
  },
  {
    roleName: 'teacher',
    emailEnv: 'DEMO_TEACHER_EMAIL',
    defaultEmail: 'teacher@demo.local',
    displayName: 'Demo Teacher',
  },
  {
    roleName: 'student',
    emailEnv: 'DEMO_STUDENT_EMAIL',
    defaultEmail: 'student@demo.local',
    displayName: 'Demo Student',
  },
];

@Injectable()
export class Auth0SeedService {
  private readonly logger = new Logger(Auth0SeedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly auth0ManagementService: Auth0ManagementService,
    @InjectRepository(UserProfile)
    private readonly userProfileRepo: Repository<UserProfile>,
  ) {}

  async run(options: SeedOptions): Promise<void> {
    this.assertCanRun();

    const shouldUpdatePassword = options.reset && options.updatePassword;
    if (options.updatePassword && !options.reset) {
      this.logger.warn(
        '--update-password fue ignorado porque solo aplica junto con --reset.',
      );
    }

    this.logger.warn('==============================================');
    this.logger.warn('AUTH0 DEVELOPMENT SEED ENABLED');
    this.logger.warn('Esto solo debe ejecutarse en development.');
    this.logger.warn('==============================================');

    const roles = await this.seedRoles();
    const scopeSync = await this.seedPermissions();
    await this.assignPermissionsToRoles(roles, scopeSync.syncedScopes);
    await this.seedUsers(roles, { shouldUpdatePassword });

    this.logger.log('Auth0 seed finalizado.');
  }

  private assertCanRun(): void {
    const nodeEnv = this.config.get<string>('NODE_ENV');
    const allowSeed = this.config.get<string>('ALLOW_AUTH0_SEED');

    if (nodeEnv !== 'development') {
      throw new ServiceUnavailableException(
        'El seed de Auth0 solo puede ejecutarse con NODE_ENV=development.',
      );
    }

    if (allowSeed !== 'true') {
      throw new ServiceUnavailableException(
        'ALLOW_AUTH0_SEED debe ser true para ejecutar el seed de Auth0.',
      );
    }
  }

  private async seedRoles(): Promise<Record<SeedRoleName, Auth0Role>> {
    const seededRoles = {} as Record<SeedRoleName, Auth0Role>;

    for (const definition of ROLE_DEFINITIONS) {
      const result = await this.auth0ManagementService.findOrCreateRole(
        definition.name,
        definition.description,
      );

      seededRoles[definition.name] = result.role;
      this.logger.log(
        `Rol ${result.created ? 'creado' : 'reusado'}: ${result.role.name} (${result.role.id})`,
      );
    }

    return seededRoles;
  }

  private async seedPermissions(): Promise<{
    syncedScopes: string[];
  }> {
    const result = await this.auth0ManagementService.ensureApiScopes(PERMISSIONS);

    if (result.createdScopes.length > 0) {
      this.logger.log(
        `Permisos creados en Auth0: ${result.createdScopes.join(', ')}`,
      );
    }

    const reusedScopes = result.syncedScopes.filter(
      (scope) => !result.createdScopes.includes(scope),
    );
    if (reusedScopes.length > 0) {
      this.logger.log(
        `Permisos existentes/sincronizados: ${reusedScopes.join(', ')}`,
      );
    }

    if (result.creationSkipped) {
      this.logger.warn(
        'La creacion de scopes via API fue omitida; revisa Auth0 Dashboard si falta algun permiso.',
      );
    }

    if (result.missingScopes.length > 0) {
      this.logger.warn(
        `Scopes no disponibles y no asignables: ${result.missingScopes.join(', ')}`,
      );
    }

    return {
      syncedScopes: result.syncedScopes,
    };
  }

  private async assignPermissionsToRoles(
    roles: Record<SeedRoleName, Auth0Role>,
    availableScopes: string[],
  ): Promise<void> {
    const availableScopeSet = new Set(availableScopes);

    for (const definition of ROLE_DEFINITIONS) {
      const desiredPermissions = ROLE_PERMISSIONS[definition.name];
      const assignablePermissions = desiredPermissions.filter((permission) =>
        availableScopeSet.has(permission),
      );
      const unavailablePermissions = desiredPermissions.filter(
        (permission) => !availableScopeSet.has(permission),
      );

      const result = await this.auth0ManagementService.assignPermissionsToRole(
        roles[definition.name].id,
        assignablePermissions.map((permissionName) => ({
          permissionName,
          description:
            PERMISSIONS.find((permission) => permission.value === permissionName)
              ?.description ?? '',
        })),
      );

      if (result.assignedPermissionNames.length > 0) {
        this.logger.log(
          `Permisos asignados a rol ${definition.name}: ${result.assignedPermissionNames.join(', ')}`,
        );
      }

      if (result.skippedPermissionNames.length > 0) {
        this.logger.log(
          `Permisos ya presentes en rol ${definition.name}: ${result.skippedPermissionNames.join(', ')}`,
        );
      }

      if (unavailablePermissions.length > 0) {
        this.logger.warn(
          `Permisos omitidos para rol ${definition.name} por no existir en Auth0: ${unavailablePermissions.join(', ')}`,
        );
      }
    }
  }

  private async seedUsers(
    roles: Record<SeedRoleName, Auth0Role>,
    options: { shouldUpdatePassword: boolean },
  ): Promise<void> {
    const connection = this.config.get<string>(
      'AUTH0_DB_CONNECTION',
      'Username-Password-Authentication',
    );
    const defaultPassword = this.config.get<string>(
      'DEMO_DEFAULT_PASSWORD',
      'Demo1234!',
    );

    for (const definition of USER_DEFINITIONS) {
      const email = this.config.get<string>(
        definition.emailEnv,
        definition.defaultEmail,
      );
      const userResult = await this.auth0ManagementService.findOrCreateUserByEmail(
        {
          email,
          password: defaultPassword,
          connection,
          name: definition.displayName,
          updatePassword: options.shouldUpdatePassword,
        },
      );

      this.logger.log(
        `Usuario ${userResult.created ? 'creado' : 'reusado'}: ${email} (${userResult.user.user_id})`,
      );

      if (userResult.updated) {
        this.logger.log(`Usuario actualizado: ${email}`);
      }

      const assignedRoles = await this.auth0ManagementService.assignRolesToUser(
        userResult.user.user_id,
        [roles[definition.roleName].id],
      );

      if (assignedRoles.assignedRoleIds.length > 0) {
        this.logger.log(
          `Roles asignados a ${email}: ${assignedRoles.roles
            .map((role) => role.name)
            .join(', ')}`,
        );
      } else {
        this.logger.log(
          `Roles ya presentes en ${email}: ${assignedRoles.roles
            .map((role) => role.name)
            .join(', ')}`,
        );
      }

      await this.syncLocalUserProfile(userResult.user, assignedRoles.roles);
    }
  }

  private async syncLocalUserProfile(
    user: Auth0User,
    roles: Auth0Role[],
  ): Promise<void> {
    const existing = await this.userProfileRepo.findOneBy({
      auth0UserId: user.user_id,
    });

    if (existing) {
      existing.email = user.email;
      existing.name = user.name ?? existing.name;
      existing.rolesCache = roles.map((role) => role.name);
      await this.userProfileRepo.save(existing);
      this.logger.log(`UserProfile local actualizado: ${user.email}`);
      return;
    }

    await this.userProfileRepo.save(
      this.userProfileRepo.create({
        auth0UserId: user.user_id,
        email: user.email,
        name: user.name ?? null,
        rolesCache: roles.map((role) => role.name),
      }),
    );
    this.logger.log(`UserProfile local creado: ${user.email}`);
  }
}
