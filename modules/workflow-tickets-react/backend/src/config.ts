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

export const config = {
  moduleId: requiredEnv("TOOLNEST_PLUGIN_ID"),
  releaseId: requiredEnv("TOOLNEST_PLUGIN_RELEASE_ID"),
  port: portEnv(),
  token: requiredEnv("TOOLNEST_PLUGIN_TOKEN"),
  dataDir: path.resolve(requiredEnv("TOOLNEST_PLUGIN_DATA_DIR")),
  logDir: path.resolve(requiredEnv("TOOLNEST_PLUGIN_LOG_DIR")),
  platformApiUrl: process.env.TOOLNEST_PLUGIN_PLATFORM_API_URL ?? "",
};
