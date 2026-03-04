import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthAdminController } from './auth-admin.controller';
import { AuthAdminService } from './auth-admin.service';
import { Auth0ManagementService } from './auth0-management.service';
import { UserProfile } from './entities/user-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserProfile])],
  controllers: [AuthAdminController],
  providers: [AuthAdminService, Auth0ManagementService],
  exports: [AuthAdminService],
})
export class AuthAdminModule {}
