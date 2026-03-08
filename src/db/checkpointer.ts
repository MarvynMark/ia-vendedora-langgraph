import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { env } from "../config/env.ts";

let checkpointer: PostgresSaver | null = null;

export async function obterCheckpointer(): Promise<PostgresSaver> {
  if (!checkpointer) {
    checkpointer = PostgresSaver.fromConnString(env.DATABASE_URL);
    await checkpointer.setup();
  }
  return checkpointer;
}

export async function encerrarCheckpointer(): Promise<void> {
  if (checkpointer) {
    await checkpointer.end();
    checkpointer = null;
  }
}
