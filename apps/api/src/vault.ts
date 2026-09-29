import { Body, ConflictException, Controller, Get, Injectable, NotFoundException, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsObject, IsString, Length, Min } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthenticatedRequest, JwtAuthGuard } from './auth';
import { SyncConflictEntity, VaultSnapshotEntity } from './entities';

class PutSnapshotDto {
  @IsInt() @Min(0) baseRevision: number;
  @IsObject() encryptedPayload: Record<string, unknown>;
  @IsString() @Length(20, 128) payloadHash: string;
}

@Injectable()
export class VaultService {
  constructor(
    @InjectRepository(VaultSnapshotEntity) private readonly snapshots: Repository<VaultSnapshotEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async latest(userId: string) {
    const snapshot = await this.snapshots.findOne({ where: { userId }, order: { revision: 'DESC' } });
    if (!snapshot) throw new NotFoundException('Vault has not been synchronized yet');
    return this.toDto(snapshot);
  }

  async history(userId: string, limit: number) {
    const snapshots = await this.snapshots.find({
      where: { userId },
      order: { revision: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return snapshots.map((snapshot) => this.toDto(snapshot));
  }

  async save(userId: string, deviceId: string | undefined, body: PutSnapshotDto) {
    const result = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const repository = manager.getRepository(VaultSnapshotEntity);
      const current = await repository.findOne({ where: { userId }, order: { revision: 'DESC' } });
      const currentRevision = current?.revision ?? 0;
      const serialized = JSON.stringify(body.encryptedPayload);
      if (body.baseRevision !== currentRevision) {
        const conflict = await manager.save(SyncConflictEntity, manager.create(SyncConflictEntity, {
          userId,
          deviceId,
          baseRevision: body.baseRevision,
          currentRevision,
          rejectedPayload: serialized,
          rejectedPayloadHash: body.payloadHash,
        }));
        return { conflictId: conflict.id, currentRevision, current: current ? this.toDto(current) : null };
      }
      if (current?.payloadHash === body.payloadHash) return { snapshot: this.toDto(current) };
      const snapshot = await repository.save(repository.create({
        userId,
        deviceId,
        revision: currentRevision + 1,
        encryptedPayload: serialized,
        payloadHash: body.payloadHash,
      }));
      return { snapshot: this.toDto(snapshot) };
    });
    if ('conflictId' in result) {
      throw new ConflictException({
        code: 'VAULT_REVISION_CONFLICT',
        conflictId: result.conflictId,
        currentRevision: result.currentRevision,
        current: result.current,
      });
    }
    return result.snapshot;
  }

  private toDto(snapshot: VaultSnapshotEntity) {
    return {
      revision: snapshot.revision,
      encryptedPayload: JSON.parse(snapshot.encryptedPayload) as unknown,
      payloadHash: snapshot.payloadHash,
      createdAt: snapshot.createdAt.toISOString(),
      deviceId: snapshot.deviceId ?? null,
    };
  }
}

@Controller('vault')
@UseGuards(JwtAuthGuard)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get()
  latest(@Req() request: AuthenticatedRequest) {
    return this.vault.latest(request.auth.sub);
  }

  @Get('history')
  history(@Req() request: AuthenticatedRequest, @Query('limit') limit = '20') {
    return this.vault.history(request.auth.sub, Number.parseInt(limit, 10) || 20);
  }

  @Put()
  save(@Req() request: AuthenticatedRequest, @Body() body: PutSnapshotDto) {
    return this.vault.save(request.auth.sub, request.auth.deviceId, body);
  }
}
