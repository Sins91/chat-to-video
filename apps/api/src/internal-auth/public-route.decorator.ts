import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_ROUTE = "internal-auth:is-public";
export const PublicRoute = () => SetMetadata(IS_PUBLIC_ROUTE, true);
