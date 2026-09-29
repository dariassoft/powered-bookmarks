import { Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { MoreThan, Repository } from 'typeorm';
import { AuthenticatedRequest, AuthService, JwtAuthGuard } from './auth';
import { DeviceEntity, DeviceLinkEntity } from './entities';

class CreateLinkDto {
  @IsString() @IsNotEmpty() deviceName: string;
  @IsOptional() @IsString() platform?: string;
}
class ApproveLinkDto { @IsString() @Length(6, 12) userCode: string; }
class PollLinkDto { @IsString() id: string; @IsString() pollSecret: string; }

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(DeviceEntity) private readonly devices: Repository<DeviceEntity>,
    @InjectRepository(DeviceLinkEntity) private readonly links: Repository<DeviceLinkEntity>,
    private readonly auth: AuthService,
  ) {}

  async createLink(body: CreateLinkDto) {
    const pollSecret = randomBytes(32).toString('base64url');
    const userCode = `${randomInt(100, 999)}-${randomInt(100, 999)}`;
    const link = await this.links.save(this.links.create({
      userCode,
      pollSecretHash: this.hash(pollSecret),
      deviceName: body.deviceName,
      platform: body.platform,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }));
    return { id: link.id, userCode, pollSecret, expiresAt: link.expiresAt.toISOString(), pollInterval: 5 };
  }

  async approve(userId: string, userCode: string) {
    const link = await this.links.findOneBy({ userCode, expiresAt: MoreThan(new Date()) });
    if (!link || link.consumedAt) throw new NotFoundException('Link code is invalid or expired');
    link.userId = userId;
    link.approvedAt = new Date();
    await this.links.save(link);
    return { approved: true, deviceName: link.deviceName };
  }

  async poll(body: PollLinkDto) {
    const link = await this.links.findOneBy({ id: body.id });
    if (!link || link.expiresAt <= new Date()) throw new NotFoundException('Link request expired');
    if (this.hash(body.pollSecret) !== link.pollSecretHash) throw new UnauthorizedException();
    if (!link.userId || !link.approvedAt) return { status: 'pending' };
    if (link.consumedAt) throw new ForbiddenException('Link request was already consumed');
    const device = await this.devices.save(this.devices.create({
      userId: link.userId,
      name: link.deviceName,
      platform: link.platform,
      lastSeenAt: new Date(),
    }));
    link.consumedAt = new Date();
    await this.links.save(link);
    return {
      status: 'approved',
      deviceId: device.id,
      accessToken: await this.auth.signAccess({ sub: link.userId, kind: 'device', deviceId: device.id }, '30d'),
      expiresIn: 30 * 24 * 60 * 60,
    };
  }

  list(userId: string) {
    return this.devices.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async revoke(userId: string, deviceId: string) {
    const device = await this.devices.findOneBy({ id: deviceId, userId });
    if (!device) throw new NotFoundException();
    device.revokedAt = new Date();
    await this.devices.save(device);
    return { revoked: true };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('device-links')
  create(@Body() body: CreateLinkDto) { return this.devices.createLink(body); }

  @Post('device-links/token')
  poll(@Body() body: PollLinkDto) { return this.devices.poll(body); }

  @Post('device-links/approve')
  @UseGuards(JwtAuthGuard)
  approve(@Req() request: AuthenticatedRequest, @Body() body: ApproveLinkDto) {
    return this.devices.approve(request.auth.sub, body.userCode);
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  list(@Req() request: AuthenticatedRequest) { return this.devices.list(request.auth.sub); }

  @Delete('devices/:id')
  @UseGuards(JwtAuthGuard)
  revoke(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.devices.revoke(request.auth.sub, id);
  }
}
