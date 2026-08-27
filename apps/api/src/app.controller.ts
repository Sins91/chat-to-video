import { Controller, Get } from "@nestjs/common";

import { PublicRoute } from "./internal-auth/public-route.decorator.js";

@Controller()
export class AppController {
  @Get("health")
  @PublicRoute()
  getHealth(): { status: "ok" } {
    return { status: "ok" };
  }
}
