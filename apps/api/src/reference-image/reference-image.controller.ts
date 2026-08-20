import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import {
  CompleteReferenceImageUploadResponseSchema,
  CreateReferenceImageUploadRequestSchema,
  ReferenceImageIdSchema,
  type CompleteReferenceImageUploadResponse,
  type CreateReferenceImageUploadResponse,
  type ReferenceImageView,
} from "@chat-to-video/contracts";

import { ReferenceImageService } from "./reference-image.service.js";

const parseId = (value: unknown): string => {
  const parsed = ReferenceImageIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ code: "INVALID_REFERENCE_IMAGE_ID", message: "参考图 ID 无效。" });
  return parsed.data;
};

@Controller("reference-images")
export class ReferenceImageController {
  constructor(@Inject(ReferenceImageService) private readonly images: ReferenceImageService) {}

  @Post("uploads")
  createUpload(@Body() body: unknown): Promise<CreateReferenceImageUploadResponse> {
    const parsed = CreateReferenceImageUploadRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: "INVALID_REFERENCE_IMAGE_UPLOAD", message: "参考图上传参数无效。", issues: parsed.error.issues });
    return this.images.createUpload(parsed.data);
  }

  @Post(":referenceImageId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  async complete(@Param("referenceImageId") value: unknown): Promise<CompleteReferenceImageUploadResponse> {
    const referenceImageId = parseId(value);
    await this.images.complete(referenceImageId);
    return CompleteReferenceImageUploadResponseSchema.parse({ accepted: true, referenceImageId, status: "validating" });
  }

  @Get(":referenceImageId")
  get(@Param("referenceImageId") value: unknown): Promise<ReferenceImageView> {
    return this.images.get(parseId(value));
  }

  @Delete(":referenceImageId")
  @HttpCode(HttpStatus.NO_CONTENT)
  abandon(@Param("referenceImageId") value: unknown): Promise<void> {
    return this.images.abandon(parseId(value));
  }
}
