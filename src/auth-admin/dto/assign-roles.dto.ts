import { ArrayNotEmpty, ArrayUnique, IsArray, IsString } from 'class-validator';

export class AssignRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds: string[];
}
