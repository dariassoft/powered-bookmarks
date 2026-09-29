import {Module} from '@nestjs/common';
import {ConfigModule, ConfigService} from '@nestjs/config';
import {JwtModule} from '@nestjs/jwt';
import {TypeOrmModule} from '@nestjs/typeorm';
import {AuthService, JwtAuthGuard} from './auth';
import {AuthController} from './auth.controller';
import {BillingController, BillingService} from './billing';
import {DevicesController, DevicesService} from './devices';
import {
  DeviceEntity,
  DeviceLinkEntity,
  StripeEventEntity,
  SubscriptionEntity,
  SyncConflictEntity,
  UserEntity,
  VaultSnapshotEntity
} from './entities';
import {HealthController} from './health.controller';
import {InitialSchema1790527560000} from './migrations/1790527560000-InitialSchema';
import {VaultController, VaultService} from './vault';

const entities = [UserEntity, DeviceEntity, DeviceLinkEntity, VaultSnapshotEntity, SyncConflictEntity, SubscriptionEntity, StripeEventEntity];

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({secret: config.getOrThrow('JWT_SECRET')}),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const synchronize = config.get('DB_SYNCHRONIZE', 'false') === 'true';

        return {
          type: 'postgres',
          url: config.getOrThrow('DATABASE_URL'),
          entities,
          migrations: [InitialSchema1790527560000],
          migrationsRun: !synchronize,
          synchronize,
          ssl: config.get('DB_SSL', 'false') === 'true' ? {rejectUnauthorized: false} : false,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [AuthController, DevicesController, VaultController, BillingController, HealthController],
  providers: [AuthService, JwtAuthGuard, DevicesService, VaultService, BillingService],
})
export class AppModule {
}
