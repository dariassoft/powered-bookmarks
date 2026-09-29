import {MigrationInterface, QueryRunner} from 'typeorm';

export class InitialSchema1790527560000 implements MigrationInterface {
  name = 'InitialSchema1790527560000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(`
      CREATE TABLE "users"
      (
        "id"            uuid                     NOT NULL DEFAULT uuid_generate_v4(),
        "googleSubject" character varying        NOT NULL,
        "email"         character varying        NOT NULL,
        "name"          character varying        NOT NULL,
        "picture"       character varying,
        "trialEndsAt"   TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"     TIMESTAMP                NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP                NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_users_googleSubject" ON "users" ("googleSubject")');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email")');

    await queryRunner.query(`
      CREATE TABLE "devices"
      (
        "id"         uuid                     NOT NULL DEFAULT uuid_generate_v4(),
        "userId"     uuid                     NOT NULL,
        "name"       character varying        NOT NULL,
        "platform"   character varying,
        "revokedAt"  TIMESTAMP WITH TIME ZONE,
        "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"  TIMESTAMP                NOT NULL DEFAULT now(),
        CONSTRAINT "PK_devices_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_devices_userId" ON "devices" ("userId")');

    await queryRunner.query(`
      CREATE TABLE "device_links"
      (
        "id"             uuid                     NOT NULL DEFAULT uuid_generate_v4(),
        "userCode"       character varying        NOT NULL,
        "pollSecretHash" character varying        NOT NULL,
        "deviceName"     character varying        NOT NULL,
        "platform"       character varying,
        "userId"         uuid,
        "expiresAt"      TIMESTAMP WITH TIME ZONE NOT NULL,
        "approvedAt"     TIMESTAMP WITH TIME ZONE,
        "consumedAt"     TIMESTAMP WITH TIME ZONE,
        "createdAt"      TIMESTAMP                NOT NULL DEFAULT now(),
        CONSTRAINT "PK_device_links_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_device_links_userCode" ON "device_links" ("userCode")');

    await queryRunner.query(`
      CREATE TABLE "vault_snapshots"
      (
        "id"               uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "userId"           uuid              NOT NULL,
        "deviceId"         uuid,
        "revision"         integer           NOT NULL,
        "encryptedPayload" text              NOT NULL,
        "payloadHash"      character varying NOT NULL,
        "createdAt"        TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vault_snapshots_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_vault_snapshots_userId" ON "vault_snapshots" ("userId")');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_vault_snapshots_userId_revision" ON "vault_snapshots" ("userId", "revision")');

    await queryRunner.query(`
      CREATE TABLE "sync_conflicts"
      (
        "id"                  uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "userId"              uuid              NOT NULL,
        "deviceId"            uuid,
        "baseRevision"        integer           NOT NULL,
        "currentRevision"     integer           NOT NULL,
        "rejectedPayload"     text              NOT NULL,
        "rejectedPayloadHash" character varying NOT NULL,
        "resolved"            boolean           NOT NULL DEFAULT false,
        "createdAt"           TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_conflicts_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_sync_conflicts_userId" ON "sync_conflicts" ("userId")');

    await queryRunner.query(`
      CREATE TABLE "subscriptions"
      (
        "id"                   uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "userId"               uuid              NOT NULL,
        "stripeCustomerId"     character varying,
        "stripeSubscriptionId" character varying,
        "status"               character varying NOT NULL DEFAULT 'trialing',
        "currentPeriodEnd"     TIMESTAMP WITH TIME ZONE,
        "updatedAt"            TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_subscriptions_userId" ON "subscriptions" ("userId")');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_subscriptions_stripeCustomerId" ON "subscriptions" ("stripeCustomerId")');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_subscriptions_stripeSubscriptionId" ON "subscriptions" ("stripeSubscriptionId")');

    await queryRunner.query(`
      CREATE TABLE "stripe_events"
      (
        "id"            uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "stripeEventId" character varying NOT NULL,
        "eventType"     character varying NOT NULL,
        "processedAt"   TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stripe_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_stripe_events_stripeEventId" ON "stripe_events" ("stripeEventId")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "stripe_events"');
    await queryRunner.query('DROP TABLE "subscriptions"');
    await queryRunner.query('DROP TABLE "sync_conflicts"');
    await queryRunner.query('DROP TABLE "vault_snapshots"');
    await queryRunner.query('DROP TABLE "device_links"');
    await queryRunner.query('DROP TABLE "devices"');
    await queryRunner.query('DROP TABLE "users"');
  }
}
