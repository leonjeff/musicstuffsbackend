import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ManagementTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface Auth0Role {
  id: string;
  name: string;
  description?: string;
}

export interface Auth0User {
  user_id: string;
  email: string;
  name?: string;
  email_verified?: boolean;
  blocked?: boolean;
  created_at?: string;
  last_login?: string;
  logins_count?: number;
}

export interface Auth0RolePermission {
  permission_name: string;
  description?: string;
  resource_server_identifier: string;
  resource_server_name?: string;
}

export interface Auth0ResourceServerScope {
  value: string;
  description?: string;
}

export interface Auth0ResourceServer {
  id: string;
  name: string;
  identifier: string;
  scopes?: Auth0ResourceServerScope[];
}

export class Auth0ManagementApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly details: unknown,
  ) {
    super(
      typeof details === 'string'
        ? details
        : 'Auth0 Management API request failed',
    );
  }
}

@Injectable()
export class Auth0ManagementService {
  private readonly logger = new Logger(Auth0ManagementService.name);
  private readonly maxAttempts = 4;
  private readonly refreshSkewMs = 60_000;
  private readonly auth0BaseUrl: string;
  private readonly tokenEndpoint: string;
  private readonly apiIdentifier: string;
  private cachedToken:
    | {
        value: string;
        expiresAt: number;
      }
    | null = null;
  private inFlightTokenPromise: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {
    const domain = this.normalizeDomain(
      this.config.getOrThrow<string>('AUTH0_DOMAIN'),
    );

    this.auth0BaseUrl = `https://${domain}`;
    this.tokenEndpoint = `${this.auth0BaseUrl}/oauth/token`;
    this.apiIdentifier = this.config.getOrThrow<string>('AUTH0_API_IDENTIFIER');
  }

  async getManagementToken(forceRefresh = false): Promise<string> {
    const now = Date.now();

    if (
      !forceRefresh &&
      this.cachedToken &&
      now < this.cachedToken.expiresAt - this.refreshSkewMs
    ) {
      return this.cachedToken.value;
    }

    if (!forceRefresh && this.inFlightTokenPromise) {
      return this.inFlightTokenPromise;
    }

    const tokenPromise = this.fetchManagementToken();
    this.inFlightTokenPromise = tokenPromise;

    try {
      return await tokenPromise;
    } finally {
      if (this.inFlightTokenPromise === tokenPromise) {
        this.inFlightTokenPromise = null;
      }
    }
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    let forceRefresh = false;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const token = await this.getManagementToken(forceRefresh);
      const response = await fetch(this.buildUrl(path, query), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await this.parseResponse(response);

      if (response.ok) {
        return payload as T;
      }

      if (response.status === 401 && !forceRefresh) {
        this.cachedToken = null;
        forceRefresh = true;
        continue;
      }

      if (this.isRetryable(response.status) && attempt < this.maxAttempts) {
        const delayMs = this.computeDelayMs(attempt, response.headers);
        this.logger.warn(
          `Auth0 Management API ${method} ${path} respondio ${response.status}; reintentando en ${delayMs}ms (intento ${attempt}/${this.maxAttempts})`,
        );
        await this.sleep(delayMs);
        continue;
      }

      throw new Auth0ManagementApiError(response.status, payload);
    }

    throw new InternalServerErrorException(
      'No se pudo completar la llamada a Auth0 Management API',
    );
  }

  async listRoles(): Promise<Auth0Role[]> {
    return this.request<Auth0Role[]>('GET', '/roles', undefined, {
      per_page: 100,
    });
  }

  async findOrCreateRole(
    name: string,
    description?: string,
  ): Promise<{ role: Auth0Role; created: boolean }> {
    const existingRoles = await this.listRoles();
    const existingRole = existingRoles.find((role) => role.name === name);

    if (existingRole) {
      return { role: existingRole, created: false };
    }

    const createdRole = await this.request<Auth0Role>('POST', '/roles', {
      name,
      description,
    });

    return { role: createdRole, created: true };
  }

  async findUserByEmail(email: string): Promise<Auth0User | null> {
    const users = await this.request<Auth0User[]>('GET', '/users', undefined, {
      q: `email:"${this.escapeSearchValue(email)}"`,
      search_engine: 'v3',
      per_page: 1,
    });

    return users[0] ?? null;
  }

  async findOrCreateUserByEmail(input: {
    email: string;
    password: string;
    connection: string;
    name: string;
    updatePassword?: boolean;
  }): Promise<{ user: Auth0User; created: boolean; updated: boolean }> {
    const existingUser = await this.findUserByEmail(input.email);

    if (existingUser) {
      let updated = false;
      const patchPayload: Record<string, string> = {};

      if (existingUser.name !== input.name) {
        patchPayload.name = input.name;
      }

      if (input.updatePassword) {
        patchPayload.password = input.password;
        patchPayload.connection = input.connection;
      }

      if (Object.keys(patchPayload).length > 0) {
        await this.request<Auth0User>(
          'PATCH',
          `/users/${encodeURIComponent(existingUser.user_id)}`,
          patchPayload,
        );
        updated = true;
      }

      const refreshedUser =
        updated || existingUser.name !== input.name
          ? await this.getUserById(existingUser.user_id)
          : existingUser;

      return {
        user: refreshedUser,
        created: false,
        updated,
      };
    }

    const createdUser = await this.request<Auth0User>('POST', '/users', {
      email: input.email,
      password: input.password,
      connection: input.connection,
      name: input.name,
    });

    return {
      user: createdUser,
      created: true,
      updated: false,
    };
  }

  async updateUserPassword(
    auth0UserId: string,
    password: string,
    connection: string,
  ): Promise<Auth0User> {
    await this.request<Auth0User>(
      'PATCH',
      `/users/${encodeURIComponent(auth0UserId)}`,
      {
        password,
        connection,
      },
    );

    return this.getUserById(auth0UserId);
  }

  async getUserById(auth0UserId: string): Promise<Auth0User> {
    return this.request<Auth0User>(
      'GET',
      `/users/${encodeURIComponent(auth0UserId)}`,
    );
  }

  async listRolesByUser(auth0UserId: string): Promise<Auth0Role[]> {
    return this.request<Auth0Role[]>(
      'GET',
      `/users/${encodeURIComponent(auth0UserId)}/roles`,
      undefined,
      {
        per_page: 100,
      },
    );
  }

  async assignRolesToUser(
    auth0UserId: string,
    roleIds: string[],
  ): Promise<{
    assignedRoleIds: string[];
    skippedRoleIds: string[];
    roles: Auth0Role[];
  }> {
    const currentRoles = await this.listRolesByUser(auth0UserId);
    const currentRoleIds = new Set(currentRoles.map((role) => role.id));
    const missingRoleIds = roleIds.filter((roleId) => !currentRoleIds.has(roleId));

    if (missingRoleIds.length > 0) {
      await this.request<void>(
        'POST',
        `/users/${encodeURIComponent(auth0UserId)}/roles`,
        { roles: missingRoleIds },
      );
    }

    const roles =
      missingRoleIds.length > 0 ? await this.listRolesByUser(auth0UserId) : currentRoles;

    return {
      assignedRoleIds: missingRoleIds,
      skippedRoleIds: roleIds.filter((roleId) => currentRoleIds.has(roleId)),
      roles,
    };
  }

  async listPermissionsByRole(roleId: string): Promise<Auth0RolePermission[]> {
    return this.request<Auth0RolePermission[]>(
      'GET',
      `/roles/${encodeURIComponent(roleId)}/permissions`,
      undefined,
      {
        per_page: 100,
      },
    );
  }

  async assignPermissionsToRole(
    roleId: string,
    permissions: Array<{
      permissionName: string;
      description?: string;
    }>,
  ): Promise<{
    assignedPermissionNames: string[];
    skippedPermissionNames: string[];
    permissions: Auth0RolePermission[];
  }> {
    const currentPermissions = await this.listPermissionsByRole(roleId);
    const currentPermissionNames = new Set(
      currentPermissions
        .filter(
          (permission) =>
            permission.resource_server_identifier === this.apiIdentifier,
        )
        .map((permission) => permission.permission_name),
    );
    const missingPermissions = permissions.filter(
      (permission) => !currentPermissionNames.has(permission.permissionName),
    );

    if (missingPermissions.length > 0) {
      await this.request<void>(
        'POST',
        `/roles/${encodeURIComponent(roleId)}/permissions`,
        {
          permissions: missingPermissions.map((permission) => ({
            permission_name: permission.permissionName,
            resource_server_identifier: this.apiIdentifier,
          })),
        },
      );
    }

    const refreshedPermissions =
      missingPermissions.length > 0
        ? await this.listPermissionsByRole(roleId)
        : currentPermissions;

    return {
      assignedPermissionNames: missingPermissions.map(
        (permission) => permission.permissionName,
      ),
      skippedPermissionNames: permissions
        .filter((permission) => currentPermissionNames.has(permission.permissionName))
        .map((permission) => permission.permissionName),
      permissions: refreshedPermissions.filter(
        (permission) =>
          permission.resource_server_identifier === this.apiIdentifier,
      ),
    };
  }

  async getApiScopes(): Promise<Auth0ResourceServer> {
    const resourceServers = await this.request<Auth0ResourceServer[]>(
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
      throw new InternalServerErrorException(
        `No existe un Resource Server con identifier ${this.apiIdentifier}`,
      );
    }

    return this.normalizeResourceServer(resourceServer);
  }

  async ensureApiScopes(
    desiredScopes: Auth0ResourceServerScope[],
  ): Promise<{
    resourceServer: Auth0ResourceServer;
    createdScopes: string[];
    syncedScopes: string[];
    missingScopes: string[];
    creationSkipped: boolean;
  }> {
    const resourceServer = await this.getApiScopes();
    const existingScopes = resourceServer.scopes ?? [];
    const existingByValue = new Map(
      existingScopes.map((scope) => [scope.value, scope]),
    );
    const missingScopes = desiredScopes.filter(
      (scope) => !existingByValue.has(scope.value),
    );

    if (missingScopes.length === 0) {
      return {
        resourceServer,
        createdScopes: [],
        syncedScopes: desiredScopes.map((scope) => scope.value),
        missingScopes: [],
        creationSkipped: false,
      };
    }

    try {
      const updatedResourceServer = await this.request<Auth0ResourceServer>(
        'PATCH',
        `/resource-servers/${encodeURIComponent(resourceServer.id)}`,
        {
          scopes: [
            ...existingScopes,
            ...missingScopes.map((scope) => ({
              value: scope.value,
              description: scope.description ?? '',
            })),
          ],
        },
      );
      const normalizedUpdatedResourceServer =
        this.normalizeResourceServer(updatedResourceServer);
      const updatedByValue = new Set(
        (normalizedUpdatedResourceServer.scopes ?? []).map(
          (scope) => scope.value,
        ),
      );

      return {
        resourceServer: normalizedUpdatedResourceServer,
        createdScopes: missingScopes
          .map((scope) => scope.value)
          .filter((scope) => updatedByValue.has(scope)),
        syncedScopes: desiredScopes
          .map((scope) => scope.value)
          .filter((scope) => updatedByValue.has(scope)),
        missingScopes: desiredScopes
          .map((scope) => scope.value)
          .filter((scope) => !updatedByValue.has(scope)),
        creationSkipped: false,
      };
    } catch (error) {
      if (
        error instanceof Auth0ManagementApiError &&
        [403, 404, 405, 501].includes(error.statusCode)
      ) {
        this.logger.warn(
          'Este tenant no permite crear scopes por Management API. Debes configurarlos en Auth0 Dashboard; continuando con sync de scopes existentes.',
        );
        const refreshedResourceServer = await this.getApiScopes();
        const refreshedValues = new Set(
          (refreshedResourceServer.scopes ?? []).map((scope) => scope.value),
        );

        return {
          resourceServer: refreshedResourceServer,
          createdScopes: [],
          syncedScopes: desiredScopes
            .map((scope) => scope.value)
            .filter((scope) => refreshedValues.has(scope)),
          missingScopes: desiredScopes
            .map((scope) => scope.value)
            .filter((scope) => !refreshedValues.has(scope)),
          creationSkipped: true,
        };
      }

      throw error;
    }
  }

  private async fetchManagementToken(): Promise<string> {
    const body = {
      grant_type: 'client_credentials',
      client_id: this.config.getOrThrow<string>('AUTH0_MGMT_CLIENT_ID'),
      client_secret: this.config.getOrThrow<string>('AUTH0_MGMT_CLIENT_SECRET'),
      audience: this.config.getOrThrow<string>('AUTH0_MGMT_AUDIENCE'),
    };

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = (await this.parseResponse(
        response,
      )) as ManagementTokenResponse;

      if (response.ok && payload?.access_token) {
        this.cachedToken = {
          value: payload.access_token,
          expiresAt: Date.now() + payload.expires_in * 1000,
        };
        return payload.access_token;
      }

      if (this.isRetryable(response.status) && attempt < this.maxAttempts) {
        const delayMs = this.computeDelayMs(attempt, response.headers);
        this.logger.warn(
          `Fallo al obtener token M2M de Auth0 (${response.status}); reintentando en ${delayMs}ms`,
        );
        await this.sleep(delayMs);
        continue;
      }

      throw new Auth0ManagementApiError(response.status, payload);
    }

    throw new InternalServerErrorException(
      'No se pudo obtener el token de Auth0 Management API',
    );
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`/api/v2${path}`, this.auth0BaseUrl);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async parseResponse(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;

    const text = await response.text();
    if (!text) return undefined;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return JSON.parse(text) as unknown;
    }

    return text;
  }

  private isRetryable(statusCode: number): boolean {
    return statusCode === 429 || statusCode >= 500;
  }

  private computeDelayMs(attempt: number, headers: Headers): number {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const retryAfterSeconds = Number(retryAfter);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
      }
    }

    const jitter = Math.floor(Math.random() * 100);
    return 250 * 2 ** (attempt - 1) + jitter;
  }

  private normalizeDomain(domain: string): string {
    return domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  private escapeSearchValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private normalizeResourceServer(
    resourceServer: Auth0ResourceServer,
  ): Auth0ResourceServer {
    return {
      ...resourceServer,
      scopes: Array.isArray(resourceServer.scopes) ? resourceServer.scopes : [],
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
