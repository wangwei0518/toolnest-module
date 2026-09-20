import path from "node:path";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function portEnv() {
  const value = process.env.TOOLNEST_PLUGIN_PORT ?? "0";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error("TOOLNEST_PLUGIN_PORT must be an integer between 0 and 65535");
  return port;
}

function databaseSchemaEnv() {
  const value = process.env.TOOLNEST_PLUGIN_DATABASE_SCHEMA ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("TOOLNEST_PLUGIN_DATABASE_SCHEMA must be a valid PostgreSQL schema name");
  return value;
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

export const config = {
  moduleId: requiredEnv("TOOLNEST_PLUGIN_ID"),
  releaseId: requiredEnv("TOOLNEST_PLUGIN_RELEASE_ID"),
  port: portEnv(),
  token: requiredEnv("TOOLNEST_PLUGIN_TOKEN"),
  dataDir: path.resolve(requiredEnv("TOOLNEST_PLUGIN_DATA_DIR")),
  logDir: path.resolve(requiredEnv("TOOLNEST_PLUGIN_LOG_DIR")),
  platformApiUrl: process.env.TOOLNEST_PLUGIN_PLATFORM_API_URL ?? "",
  databaseUrl: requiredEnv("TOOLNEST_PLUGIN_DATABASE_URL"),
  databaseSchema: databaseSchemaEnv(),
  databasePoolMax: numberEnv("TOOLNEST_PLUGIN_DATABASE_POOL_MAX", 2, 1, 16),
};
