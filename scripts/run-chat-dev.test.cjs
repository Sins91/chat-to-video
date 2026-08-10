const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

test("chat dev builds API workspace dependencies before starting watchers", async () => {
  const source = await readFile(join(__dirname, "run-chat-dev.cjs"), "utf8");

  assert.match(source, /await buildApiWorkspaceDependencies\(\)/u);
  assert.match(source, /"@chat-to-video\/api", "build:workspace-deps"/u);
  assert.match(source, /API workspace dependency build failed/u);
});
