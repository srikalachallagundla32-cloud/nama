process.stdout.write('[startup] tsx loaded\n');
import { loadConfig } from './config.ts';
import { createServices } from './app.ts';

process.stdout.write('[startup] imports done\n');
const config = loadConfig();
process.stdout.write(`[startup] config ok host=${config.HOST} port=${config.PORT} env=${config.NODE_ENV}\n`);
const { app } = createServices(config);
process.stdout.write('[startup] services created\n');
await app.listen({ host: config.HOST, port: config.PORT });
process.stdout.write('[startup] listening\n');
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)); });
