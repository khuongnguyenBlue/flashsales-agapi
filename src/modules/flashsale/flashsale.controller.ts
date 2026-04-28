import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { Public } from '../../shared/http/public.decorator';
import { RateLimit } from '../../shared/http/rate-limit.guard';
import { IdempotencyInterceptor } from '../../shared/http/idempotency.interceptor';
import { FlashSaleService } from './flashsale.service';
import { ListActiveQueryDto } from './dto/list-active-query.dto';
import { PurchaseDto } from './dto/purchase.dto';

@Controller('v1/flashsale')
export class FlashSaleController {
  constructor(private readonly service: FlashSaleService) {}

  @Get('active')
  @Public()
  listActive(@Query() query: ListActiveQueryDto) {
    const at = query.at ? new Date(query.at) : new Date();
    return this.service.listActive(at).then((items) => ({ items }));
  }

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @RateLimit({ prefix: 'purchase', key: 'user_id', capacity: 10, refillPerSec: 10 })
  @UseInterceptors(IdempotencyInterceptor)
  async purchase(
    @Body() dto: PurchaseDto,
    @Request() req: FastifyRequest & { user: JwtPayload },
  ) {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const result = await this.service.purchase(req.user.id, dto.sale_item_id, idempotencyKey);
    return {
      purchase_id: result.purchaseId,
      sale_item_id: result.saleItemId,
      price_cents: result.priceCents.toString(),
      remaining_allocation: result.remainingAllocation,
    };
  }
}
