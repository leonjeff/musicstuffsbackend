import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthAdminModule } from './auth-admin/auth-admin.module';
import { UserProfile } from './auth-admin/entities/user-profile.entity';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { VideoModule } from './video/video.module';
import { Video } from './video/entities/video.entity';
import { LoopModule } from './loop/loop.module';
import { Loop } from './loop/entities/loop.entity';
import { AudioVariantModule } from './audio-variant/audio-variant.module';
import { AudioVariant } from './audio-variant/entities/audio-variant.entity';
import { CoursesModule } from './courses/courses.module';
import { Course } from './courses/entities/course.entity';
import { CourseModule } from './courses/entities/course-module.entity';
import { Lesson } from './courses/entities/lesson.entity';
import { LessonResource } from './courses/entities/lesson-resource.entity';
import { CourseProgress } from './students/entities/course-progress.entity';
import { Enrollment } from './students/entities/enrollment.entity';
import { LastLessonViewed } from './students/entities/last-lesson-viewed.entity';
import { LessonProgress } from './students/entities/lesson-progress.entity';
import { Student } from './students/entities/student.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: config.get<number>('THROTTLE_TTL', 60000),
        limit: config.get<number>('THROTTLE_LIMIT', 100),
      }]),
    }),
    AuthModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get('DB_USER'),
        password: config.get('DB_PASS'),
        database: config.get('DB_NAME'),
        entities: [
          Video,
          Loop,
          AudioVariant,
          Course,
          CourseModule,
          Lesson,
          LessonResource,
          Student,
          Enrollment,
          LessonProgress,
          CourseProgress,
          LastLessonViewed,
          UserProfile,
        ],
        synchronize: true,
      }),
    }),
    VideoModule,
    LoopModule,
    AudioVariantModule,
    CoursesModule,
    AuthAdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
