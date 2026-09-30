import { loadConfig } from './config.ts';
import { createServices } from './app.ts';

const config = loadConfig();
const { app } = createServices(config);
await app.listen({ host: config.HOST, port: config.PORT });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)); });
