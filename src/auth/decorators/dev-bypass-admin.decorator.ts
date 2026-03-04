import { SetMetadata } from '@nestjs/common';

export const DEV_BYPASS_ADMIN_KEY = 'DEV_BYPASS_ADMIN_KEY';
export const AllowDevBypassAdmin = () =>
  SetMetadata(DEV_BYPASS_ADMIN_KEY, true);
