type LogLevel = "debug" | "info" | "warn" | "error";

function log(level: LogLevel, tag: string, message: string, data?: unknown) {
  if (process.env["NODE_ENV"] === "test") return;
  const isDev = process.env["NODE_ENV"] !== "production";
  if (isDev) {
    const prefix = `[${tag}]`;
    if (level === "error") console.error(prefix, message, ...(data !== undefined ? [data] : []));
    else if (level === "warn") console.warn(prefix, message, ...(data !== undefined ? [data] : []));
    else console.log(prefix, message, ...(data !== undefined ? [data] : []));
  } else {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      tag,
      msg: message,
    };
    if (data !== undefined) entry["data"] = data;
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export const logger = {
  debug: (tag: string, message: string, data?: unknown) => log("debug", tag, message, data),
  info: (tag: string, message: string, data?: unknown) => log("info", tag, message, data),
  warn: (tag: string, message: string, data?: unknown) => log("warn", tag, message, data),
  error: (tag: string, message: string, data?: unknown) => log("error", tag, message, data),
};
