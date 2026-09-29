import { BadRequestException, Body, Controller, Get, Injectable, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import { AuthenticatedRequest, JwtAuthGuard } from './auth';
import { StripeEventEntity, SubscriptionEntity, UserEntity } from './entities';

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(SubscriptionEntity) private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(StripeEventEntity) private readonly events: Repository<StripeEventEntity>,
  ) {
    this.stripe = new Stripe(this.config.getOrThrow('STRIPE_SECRET_KEY'));
  }

  async checkout(userId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    const subscription = await this.subscriptions.findOneBy({ userId });
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: subscription?.stripeCustomerId,
      customer_email: subscription?.stripeCustomerId ? undefined : user.email,
      line_items: [{ price: this.config.getOrThrow('STRIPE_PRICE_ID'), quantity: 1 }],
      success_url: `${this.config.getOrThrow('WEB_URL')}/?checkout=success`,
      cancel_url: `${this.config.getOrThrow('WEB_URL')}/?checkout=canceled`,
      client_reference_id: userId,
      metadata: { userId },
    });
    return { url: session.url };
  }

  async license(userId: string) {
    const [user, subscription] = await Promise.all([
      this.users.findOneByOrFail({ id: userId }),
      this.subscriptions.findOneBy({ userId }),
    ]);
    const trialActive = user.trialEndsAt.getTime() > Date.now();
    const paidActive = subscription?.status === 'active' || subscription?.status === 'trialing';
    const status = paidActive ? subscription.status : trialActive ? 'trialing' : subscription?.status ?? 'expired';
    const claims = { sub: userId, status, trialEndsAt: user.trialEndsAt.toISOString(), kind: 'license' };
    return {
      status,
      trialEndsAt: user.trialEndsAt.toISOString(),
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString(),
      signedLicense: await this.jwt.signAsync(claims, { expiresIn: '24h' }),
    };
  }

  async webhook(signature: string | undefined, rawBody: Buffer | undefined) {
    if (!signature || !rawBody) throw new BadRequestException('Missing Stripe signature');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.config.getOrThrow('STRIPE_WEBHOOK_SECRET'));
    if (await this.events.existsBy({ stripeEventId: event.id })) return { received: true };
    if (event.type === 'checkout.session.completed') await this.handleCheckout(event.data.object);
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await this.handleSubscription(event.data.object);
    }
    await this.events.save(this.events.create({ stripeEventId: event.id, eventType: event.type }));
    return { received: true };
  }

  private async handleCheckout(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.userId ?? session.client_reference_id;
    if (!userId || typeof session.customer !== 'string') return;
    let subscription = await this.subscriptions.findOneBy({ userId });
    subscription ??= this.subscriptions.create({ userId });
    subscription.stripeCustomerId = session.customer;
    subscription.stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : undefined;
    subscription.status = session.payment_status === 'paid' ? 'active' : 'past_due';
    await this.subscriptions.save(subscription);
  }

  private async handleSubscription(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await this.subscriptions.findOneBy({ stripeSubscriptionId: stripeSubscription.id });
    if (!subscription) return;
    subscription.status = stripeSubscription.status;
    subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
    await this.subscriptions.save(subscription);
  }
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Req() request: AuthenticatedRequest) { return this.billing.checkout(request.auth.sub); }

  @Get('license')
  @UseGuards(JwtAuthGuard)
  license(@Req() request: AuthenticatedRequest) { return this.billing.license(request.auth.sub); }

  @Post('webhook')
  webhook(@Req() request: RawBodyRequest<Request>, @Body() _body: unknown) {
    return this.billing.webhook(request.headers['stripe-signature'] as string | undefined, request.rawBody);
  }
}
