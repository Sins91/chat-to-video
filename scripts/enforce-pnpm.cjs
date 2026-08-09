'use strict';

const userAgent = process.env.npm_config_user_agent ?? '';

if (!userAgent.startsWith('pnpm/')) {
  console.error('\nERROR: This repository only supports pnpm.');
  console.error('Please run "corepack enable" and use pnpm commands.');
  console.error(`Detected package manager: ${userAgent || 'unknown'}\n`);
  process.exit(1);
}

console.log(`Package manager check passed: ${userAgent.split(' ')[0]}`);
