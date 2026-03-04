import { ArrayNotEmpty, ArrayUnique, IsArray, IsString } from 'class-validator';

export class AssignPermissionsToRoleDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  permissionNames: string[];
}
