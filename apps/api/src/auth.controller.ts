import { Body, Controller, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService } from './auth';

class GoogleLoginDto {
  @IsString() @IsNotEmpty() idToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('google')
  login(@Body() body: GoogleLoginDto) {
    return this.auth.authenticateGoogle(body.idToken);
  }
}
