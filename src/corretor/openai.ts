// Infraestrutura de IA do corretor: anexos (foto/PDF → conteúdo da API) e chamada JSON estrita.
//
// Vai direto na API de Chat Completions: imagem e PDF precisam ir na mesma mensagem (o PDF
// escaneado vira páginas para o modelo), e o formato "file" não passa pelo ChatOpenAI do LangChain.
import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { comRetry } from "../lib/retry.ts";
import { logger } from "../lib/logger.ts";

export interface Anexo {
  tipo: string;   // file_type do Chatwoot: "image" | "file" | ...
  url: string;
}

const LIMITE_BYTES = 20 * 1024 * 1024;

export type ParteConteudo =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } }
  | { type: "file"; file: { filename: string; file_data: string } };

export function tipoPorExtensao(url: string): string | null {
  const ext = url.split("?")[0]!.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

/** Baixa o anexo do Chatwoot e devolve no formato que a API aceita (imagem ou PDF). */
export async function anexoParaConteudo(anexo: Anexo, indice: number): Promise<ParteConteudo> {
  const res = await fetchComTimeout(anexo.url, { timeout: 60_000 });
  if (!res.ok) throw new Error(`[corretor] Falha ao baixar anexo (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const cabecalho = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const mime = cabecalho.startsWith("image/") || cabecalho === "application/pdf" ? cabecalho : tipoPorExtensao(anexo.url);
  return bytesParaConteudo(bytes, mime, indice);
}

/** Bytes de uma foto/PDF → parte de conteúdo da API (também usado pelo script de teste local). */
export function bytesParaConteudo(bytes: Uint8Array, mime: string | null, indice: number): ParteConteudo {
  if (bytes.length > LIMITE_BYTES) throw new ErroAnexo("O arquivo passa de 20 MB. Mande fotos das páginas ou um PDF menor.");
  if (!mime) throw new ErroAnexo("Consigo ler foto, PDF ou texto. Esse tipo de arquivo eu não consigo abrir.");
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  return mime === "application/pdf"
    ? { type: "file", file: { filename: `pagina-${indice + 1}.pdf`, file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl, detail: "high" } };
}


/** Erro com mensagem que pode ir direto para o aluno. */
export class ErroAnexo extends Error {}

export async function chamarJson<T>(
  sistema: string,
  conteudo: ParteConteudo[],
  nome: string,
  schema: Record<string, unknown>,
): Promise<T> {
  return comRetry(async () => {
    const res = await fetchComTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.CORRETOR_MODELO,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: conteudo },
        ],
        response_format: { type: "json_schema", json_schema: { name: nome, strict: true, schema } },
      }),
      timeout: 180_000,
    });
    if (!res.ok) throw new Error(`[corretor] OpenAI ${nome} falhou (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
      usage?: Record<string, unknown>;
    };
    const msg = data.choices?.[0]?.message;
    if (!msg?.content) throw new Error(`[corretor] OpenAI ${nome} sem conteúdo${msg?.refusal ? `: ${msg.refusal}` : ""}`);
    logger.info("corretor", `OpenAI ${nome} ok`, { usage: data.usage });
    return JSON.parse(msg.content) as T;
  }, 2, 2000);
}
