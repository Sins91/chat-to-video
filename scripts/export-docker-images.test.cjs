const assert = require("node:assert/strict");
const { join } = require("node:path");
const { describe, it } = require("node:test");

const {
  ARCHIVE_NAME,
  assertImagePlatform,
  createImagePlan,
  formatBytes,
  parseComposeConfig,
  resolveBuiltImageName,
  resolveOutputPaths,
} = require("./export-docker-images.cjs");

describe("Docker image export helpers", () => {
  const composeConfig = {
    name: "chat-to-video",
    services: {
      api: { build: { target: "api-runtime" } },
      "database-migrate": { build: { target: "database-migrate" } },
      minio: { image: "minio/minio:release" },
      "minio-init": { image: "minio/mc:release" },
      mysql: { image: "mysql:8.4" },
      redis: { image: "redis:7.4-alpine" },
      web: { build: { target: "web-runtime" } },
      worker: { build: { target: "worker-runtime" } },
    },
  };

  it("parses a valid Compose configuration", () => {
    assert.deepEqual(parseComposeConfig(JSON.stringify(composeConfig)), composeConfig);
  });

  it("rejects invalid or incomplete Compose configuration", () => {
    assert.throws(() => parseComposeConfig("not-json"), /Unable to parse/u);
    assert.throws(() => parseComposeConfig('{"services":{}}'), /missing/u);
  });

  it("selects build and pull images while excluding both MinIO services", () => {
    assert.deepEqual(createImagePlan(composeConfig), {
      buildServices: ["api", "database-migrate", "web", "worker"],
      images: [
        "chat-to-video-api",
        "chat-to-video-database-migrate",
        "mysql:8.4",
        "redis:7.4-alpine",
        "chat-to-video-web",
        "chat-to-video-worker",
      ],
      pullImages: ["mysql:8.4", "redis:7.4-alpine"],
    });
  });

  it("prefers an explicit build image name and removes duplicates", () => {
    const plan = createImagePlan({
      name: "demo",
      services: {
        api: { build: {}, image: "registry.example/demo:latest" },
        alias: { image: "registry.example/demo:latest" },
      },
    });

    assert.deepEqual(plan.images, ["registry.example/demo:latest"]);
    assert.deepEqual(plan.buildServices, ["api"]);
    assert.deepEqual(plan.pullImages, ["registry.example/demo:latest"]);
  });

  it("derives Compose image names and output paths consistently", () => {
    assert.equal(resolveBuiltImageName("chat-to-video", "api"), "chat-to-video-api");
    assert.deepEqual(resolveOutputPaths(join("workspace", "repo"), 42), {
      archivePath: join("workspace", "repo", "outputs", "images", ARCHIVE_NAME),
      outputDirectory: join("workspace", "repo", "outputs", "images"),
      temporaryArchivePath: join(
        "workspace",
        "repo",
        "outputs",
        "images",
        `.${ARCHIVE_NAME}.42.tmp`,
      ),
    });
  });

  it("accepts only linux/amd64 images", () => {
    assert.doesNotThrow(() => assertImagePlatform("demo", "linux/amd64\n"));
    assert.throws(
      () => assertImagePlatform("demo", "linux/arm64"),
      /expected linux\/amd64/u,
    );
  });

  it("formats archive sizes for terminal output", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1024), "1.00 KiB");
    assert.equal(formatBytes(1024 * 1024), "1.00 MiB");
  });
});
