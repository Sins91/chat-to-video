import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

const parseApiPort = (value: string): number => {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`API_PORT must be an integer between 1 and 65535; received "${value}".`);
  }

  return port;
};

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  const apiPort = parseApiPort(process.env.API_PORT ?? "3001");

  app.enableShutdownHooks();
  await app.listen(apiPort, "0.0.0.0");
};

void bootstrap();

