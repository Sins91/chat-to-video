const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const loadLocalEnvironment = () => {
  const path = resolve(process.cwd(), ".env.local");
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line.trim());
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, "$2");
  }
};

const main = async () => {
  if (process.env.STORAGE_CONNECTIVITY_CONFIRM !== "WRITE_AND_DELETE_TEMP_OBJECT") {
    throw new Error("Set STORAGE_CONNECTIVITY_CONFIRM=WRITE_AND_DELETE_TEMP_OBJECT to authorize the temporary object check.");
  }
  loadLocalEnvironment();
  const { ObjectStorage, loadStorageConfigFromEnvironment } = await import("../packages/storage/dist/index.js");
  const config = loadStorageConfigFromEnvironment(process.env);
  const storage = new ObjectStorage(config);
  const objectKey = `tenant/demo/project/demo/temp/connectivity/${randomUUID()}.txt`;
  const contentType = "text/plain; charset=utf-8";
  const body = new TextEncoder().encode("chat-to-video storage connectivity check");
  let uploaded = false;

  try {
    const uploadUrl = await storage.createUploadUrl(objectKey, contentType, 300);
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    });
    if (!uploadResponse.ok) throw new Error(`Signed upload failed with HTTP ${uploadResponse.status}.`);
    uploaded = true;

    const stat = await storage.statObject(objectKey);
    if (stat.contentLength !== body.byteLength) throw new Error("Stored object length does not match the upload.");
    const downloaded = await storage.getObject(objectKey);
    if (new TextDecoder().decode(downloaded) !== new TextDecoder().decode(body)) {
      throw new Error("Stored object content does not match the upload.");
    }
    const downloadUrl = await storage.createDownloadUrl(objectKey, 300);
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) throw new Error(`Signed download failed with HTTP ${downloadResponse.status}.`);
    console.log(`Storage connectivity passed for provider ${config.provider}.`);
  } finally {
    if (uploaded) await storage.deleteObject(objectKey);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Storage connectivity check failed.");
  process.exitCode = 1;
});
