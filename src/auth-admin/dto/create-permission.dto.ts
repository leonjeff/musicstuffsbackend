import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
