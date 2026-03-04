import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Auth0ManagementService } from '../../auth-admin/auth0-management.service';
import { UserProfile } from '../../auth-admin/entities/user-profile.entity';
import { Auth0SeedService } from './auth0-seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get('DB_USER'),
        password: config.get('DB_PASS'),
        database: config.get('DB_NAME'),
        entities: [UserProfile],
        synchronize: true,
      }),
    }),
    TypeOrmModule.forFeature([UserProfile]),
  ],
  providers: [Auth0ManagementService, Auth0SeedService],
  exports: [Auth0SeedService],
})
export class Auth0SeedModule {}
