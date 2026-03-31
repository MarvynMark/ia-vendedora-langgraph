type LogLevel = "debug" | "info" | "warn" | "error";

const CORES = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
};

const COR_NIVEL: Record<LogLevel, string> = {
  debug: CORES.dim,
  info:  CORES.cyan,
  warn:  CORES.yellow,
  error: CORES.red,
};

function timestamp(): string {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function log(level: LogLevel, tag: string, message: string, data?: unknown) {
  if (process.env["NODE_ENV"] === "test") return;

  const useJson = process.env["LOG_FORMAT"] === "json";

  if (useJson) {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, tag, msg: message };
    if (data !== undefined) entry["data"] = data;
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  const cor = COR_NIVEL[level];
  const ts = `${CORES.dim}${timestamp()}${CORES.reset}`;
  const prefix = `${ts} ${cor}[${tag}]${CORES.reset}`;

  if (data !== undefined) {
    if (level === "error") console.error(prefix, message, data);
    else if (level === "warn") console.warn(prefix, message, data);
    else console.log(prefix, message, data);
  } else {
    if (level === "error") console.error(prefix, message);
    else if (level === "warn") console.warn(prefix, message);
    else console.log(prefix, message);
  }
}

export const logger = {
  debug: (tag: string, message: string, data?: unknown) => log("debug", tag, message, data),
  info:  (tag: string, message: string, data?: unknown) => log("info", tag, message, data),
  warn:  (tag: string, message: string, data?: unknown) => log("warn", tag, message, data),
  error: (tag: string, message: string, data?: unknown) => log("error", tag, message, data),
};
