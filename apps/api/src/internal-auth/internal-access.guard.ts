import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, timingSafeEqual } from "node:crypto";

import { readApiAuthConfig } from "./internal-auth.config.js";
import { IS_PUBLIC_ROUTE } from "./public-route.decorator.js";

const tokensMatch = (received: string, expected: string): boolean => {
  const receivedDigest = createHash("sha256").update(received, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
};

@Injectable()
export class InternalAccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const config = readApiAuthConfig();
    if (!config.isEnabled) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers["x-internal-access-token"];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token || !tokensMatch(token, config.internalApiToken)) {
      throw new UnauthorizedException("Internal access authentication is required.");
    }
    return true;
  }
}
