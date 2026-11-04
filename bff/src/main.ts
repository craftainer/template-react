import { loadConfig } from "@craftainer/bff";
import { buildApp } from "./app.ts";

// Throws a ConfigError listing every problem (never a secret value).
const config = loadConfig(process.env);
const app = await buildApp(config);

await app.listen({ port: config.port, host: config.host });
