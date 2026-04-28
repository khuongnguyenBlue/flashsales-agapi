import { IsISO8601, IsOptional } from 'class-validator';

export class ListActiveQueryDto {
  @IsOptional()
  @IsISO8601()
  at?: string;
}
