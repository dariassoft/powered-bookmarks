import 'reflect-metadata';
import {DataSource} from 'typeorm';
import {
  DeviceEntity,
  DeviceLinkEntity,
  StripeEventEntity,
  SubscriptionEntity,
  SyncConflictEntity,
  UserEntity,
  VaultSnapshotEntity
} from './entities';
import {InitialSchema1790527560000} from './migrations/1790527560000-InitialSchema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [UserEntity, DeviceEntity, DeviceLinkEntity, VaultSnapshotEntity, SyncConflictEntity, SubscriptionEntity, StripeEventEntity],
  migrations: [InitialSchema1790527560000],
  migrationsRun: false,
  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  ssl: process.env.DB_SSL === 'true' ? {rejectUnauthorized: false} : false,
});
