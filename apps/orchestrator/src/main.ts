import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
import 'source-map-support/register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { NestFactory } from '@nestjs/core';
import { AppModule } from '@gitroom/orchestrator/app.module';
import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const port = process.env.ORCHESTRATOR_PORT || 3002;

  try {
    await app.listen(port);
    console.log(`🚀 Orchestrator is running on port ${port}`);
  } catch (err: any) {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} is already in use. Assuming hot-reload in progress...`);
    } else {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    }
  }
}

bootstrap();
