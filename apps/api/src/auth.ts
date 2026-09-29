import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { Repository } from 'typeorm';
import { DeviceEntity, UserEntity } from './entities';

export interface AccessClaims {
  sub: string;
  kind: 'user' | 'device';
  deviceId?: string;
}

export interface AuthenticatedRequest extends Request {
  auth: AccessClaims;
}

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async authenticateGoogle(idToken: string) {
    if (!idToken) throw new UnauthorizedException('Google ID token is required');
    const audience = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const ticket = await this.googleClient.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException('Google account is not verified');
    }
    let user = await this.users.findOneBy([{ googleSubject: payload.sub }, { email: payload.email }]);
    if (!user) {
      user = this.users.create({
        googleSubject: payload.sub,
        email: payload.email,
        name: payload.name ?? payload.email,
        picture: payload.picture,
        trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      });
    } else {
      user.googleSubject = payload.sub;
      user.name = payload.name ?? user.name;
      user.picture = payload.picture;
    }
    user = await this.users.save(user);
    return {
      accessToken: await this.signAccess({ sub: user.id, kind: 'user' }),
      expiresIn: 3600,
      user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
    };
  }

  signAccess(claims: AccessClaims, expiresIn: JwtSignOptions['expiresIn'] = '1h'): Promise<string> {
    return this.jwt.signAsync(claims, { expiresIn });
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(DeviceEntity) private readonly devices: Repository<DeviceEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const value = request.headers.authorization;
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException();
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(value.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (claims.kind === 'device') {
      if (!claims.deviceId) throw new UnauthorizedException('Device identity is missing');
      const device = await this.devices.findOneBy({ id: claims.deviceId, userId: claims.sub });
      if (!device || device.revokedAt) throw new UnauthorizedException('Device was revoked');
      device.lastSeenAt = new Date();
      await this.devices.save(device);
    }
    request.auth = claims;
    return true;
  }
}
