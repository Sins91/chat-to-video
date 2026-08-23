import {
  CompleteReferenceImageUploadResponseSchema,
  CreateReferenceImageUploadResponseSchema,
  ReferenceImageViewSchema,
  type ReferenceImageDeclaration,
  type ReferenceImageView,
} from "@chat-to-video/contracts";
import { createAlova } from "alova";
import adapterFetch from "alova/fetch";

export class ReferenceImageRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ReferenceImageRequestError";
  }
}

const referenceImageApi = createAlova({
  baseURL: "/api",
  requestAdapter: adapterFetch(),
  cacheFor: null,
  responded: async (response) => {
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new ReferenceImageRequestError("参考图服务暂不可用。", response.status);
    return body;
  },
});

const waitForReady = async (id: string): Promise<ReferenceImageView> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const image = ReferenceImageViewSchema.parse(
      await referenceImageApi.Get(`/reference-images/${encodeURIComponent(id)}`).send(true),
    );
    if (image.status === "ready") return image;
    if (image.status === "rejected" || image.status === "abandoned") throw new Error("参考图未通过安全校验。");
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error("参考图校验超时，请重试。");
};

export const getReferenceImage = async (id: string): Promise<ReferenceImageView> => {
  const image = ReferenceImageViewSchema.parse(
    await referenceImageApi.Get(`/reference-images/${encodeURIComponent(id)}`).send(true),
  );
  if (image.status !== "ready") throw new Error("参考图当前不可用。");
  return image;
};

export const uploadReferenceImage = async (
  file: File,
  declaration?: ReferenceImageDeclaration,
): Promise<ReferenceImageView> => {
  const created = CreateReferenceImageUploadResponseSchema.parse(
    await referenceImageApi.Post("/reference-images/uploads", {
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      declaration,
    }).send(),
  );
  const uploaded = await fetch(created.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "content-type": file.type },
  });
  if (!uploaded.ok) throw new Error("参考图直传失败。");
  CompleteReferenceImageUploadResponseSchema.parse(
    await referenceImageApi.Post(`/reference-images/${encodeURIComponent(created.referenceImage.id)}/complete`).send(),
  );
  return waitForReady(created.referenceImage.id);
};

export const abandonReferenceImage = async (id: string): Promise<void> => {
  await referenceImageApi.Delete(`/reference-images/${encodeURIComponent(id)}`).send();
};
