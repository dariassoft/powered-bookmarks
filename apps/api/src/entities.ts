import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() googleSubject: string;
  @Index({ unique: true }) @Column() email: string;
  @Column() name: string;
  @Column({ nullable: true }) picture?: string;
  @Column({ type: 'timestamptz' }) trialEndsAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('devices')
export class DeviceEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') userId: string;
  @Column() name: string;
  @Column({ nullable: true }) platform?: string;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt?: Date;
  @Column({ type: 'timestamptz' }) lastSeenAt: Date;
  @CreateDateColumn() createdAt: Date;
}

@Entity('device_links')
export class DeviceLinkEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() userCode: string;
  @Column() pollSecretHash: string;
  @Column() deviceName: string;
  @Column({ nullable: true }) platform?: string;
  @Column('uuid', { nullable: true }) userId?: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) approvedAt?: Date;
  @Column({ type: 'timestamptz', nullable: true }) consumedAt?: Date;
  @CreateDateColumn() createdAt: Date;
}

@Entity('vault_snapshots')
@Index(['userId', 'revision'], { unique: true })
export class VaultSnapshotEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') userId: string;
  @Column('uuid', { nullable: true }) deviceId?: string;
  @Column('integer') revision: number;
  @Column('text') encryptedPayload: string;
  @Column() payloadHash: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('sync_conflicts')
export class SyncConflictEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') userId: string;
  @Column('uuid', { nullable: true }) deviceId?: string;
  @Column('integer') baseRevision: number;
  @Column('integer') currentRevision: number;
  @Column('text') rejectedPayload: string;
  @Column() rejectedPayloadHash: string;
  @Column({ default: false }) resolved: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column('uuid') userId: string;
  @Index({ unique: true }) @Column({ nullable: true }) stripeCustomerId?: string;
  @Index({ unique: true }) @Column({ nullable: true }) stripeSubscriptionId?: string;
  @Column({ default: 'trialing' }) status: string;
  @Column({ type: 'timestamptz', nullable: true }) currentPeriodEnd?: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('stripe_events')
export class StripeEventEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() stripeEventId: string;
  @Column() eventType: string;
  @CreateDateColumn() processedAt: Date;
}
