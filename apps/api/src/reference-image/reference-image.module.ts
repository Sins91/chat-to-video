import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database.module.js";
import { ModelGatewayModule } from "../model-gateway/model-gateway.module.js";
import { ReferenceImageController } from "./reference-image.controller.js";
import { ReferenceImageService } from "./reference-image.service.js";

@Module({
  imports: [DatabaseModule, ModelGatewayModule],
  controllers: [ReferenceImageController],
  providers: [ReferenceImageService],
  exports: [ReferenceImageService],
})
export class ReferenceImageModule {}
