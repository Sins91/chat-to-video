'use strict';

const { spawnSync } = require('node:child_process');

const PROBE_TIMEOUT_MS = 3_000;
const REGISTRIES = [
  {
    name: 'npmmirror',
    url: 'https://registry.npmmirror.com/',
  },
  {
    name: 'Tencent Cloud',
    url: 'https://mirrors.cloud.tencent.com/npm/',
  },
  {
    name: 'Huawei Cloud',
    url: 'https://mirrors.huaweicloud.com/repository/npm/',
  },
  {
    name: 'npm official',
    url: 'https://registry.npmjs.org/',
    isFallback: true,
  },
];

async function isRegistryReachable(registry) {
  try {
    const response = await fetch(new URL('-/ping', registry.url), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    return response.ok;
  } catch {
    return false;
  }
}

function resolvePnpmCommand() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    return {
      command: process.execPath,
      prefixArguments: [npmExecPath],
    };
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    prefixArguments: [],
  };
}

async function selectRegistry() {
  for (const registry of REGISTRIES) {
    process.stdout.write(`Checking ${registry.name}: ${registry.url} ... `);

    if (await isRegistryReachable(registry)) {
      console.log('available');
      return registry;
    }

    console.log('unavailable');
  }

  const officialRegistry = REGISTRIES.find((registry) => registry.isFallback);

  if (!officialRegistry) {
    throw new Error('The npm official fallback registry is not configured.');
  }

  console.warn(
    `All registry probes failed; continuing with the official fallback: ${officialRegistry.url}`,
  );
  return officialRegistry;
}

async function main() {
  const registry = await selectRegistry();
  const { command, prefixArguments } = resolvePnpmCommand();
  const installArguments = process.argv.slice(2);

  console.log(`Using ${registry.name}: ${registry.url}`);

  const result = spawnSync(
    command,
    [
      ...prefixArguments,
      'install',
      ...installArguments,
      `--registry=${registry.url}`,
    ],
    {
      env: {
        ...process.env,
        npm_config_registry: registry.url,
      },
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
