import { Controller, Get, Inject } from "@nestjs/common";
import type { ApimartAccountBalance } from "@chat-to-video/contracts";

import { ApimartAccountService } from "./apimart-account.service.js";

@Controller("apimart/account")
export class ApimartAccountController {
  constructor(
    @Inject(ApimartAccountService)
    private readonly apimartAccount: ApimartAccountService,
  ) {}

  @Get("balance")
  getBalance(): Promise<ApimartAccountBalance> {
    return this.apimartAccount.getBalance();
  }
}
