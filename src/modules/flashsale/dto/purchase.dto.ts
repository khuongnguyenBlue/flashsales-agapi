import { IsUUID } from 'class-validator';

export class PurchaseDto {
  @IsUUID()
  sale_item_id!: string;
}
