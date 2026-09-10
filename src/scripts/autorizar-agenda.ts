// Autorização única do Google Calendar (OAuth) para o funil de sessão estratégica.
//
// Por que OAuth e não Service Account: o Workspace da csiacademy.com.br aplica a política
// `iam.managed.disableServiceAccountKeyCreation`, que proíbe criar chaves de conta de serviço.
// OAuth não é chave de conta de serviço, então passa — e tem uma vantagem real: agindo COMO um
// usuário de verdade, a API consegue criar sala do Google Meet por evento, coisa que Service
// Account em calendário compartilhado não faz.
//
// O app está como INTERNO no Workspace, então o refresh token não expira (num Gmail comum ele
// morreria a cada 7 dias, porque o app ficaria preso em "Testing").
//
// Uso:
//   bun run src/scripts/autorizar-agenda.ts ~/Downloads/client_secret_....json
//
// Ao final imprime as três linhas para colar no .env (local) e no Coolify (produção).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { google } from "googleapis";

const ESCOPOS = ["https://www.googleapis.com/auth/calendar"];
const PORTA = 53682; // porta alta e fixa: o cliente é "App para computador", então loopback vale

const caminho = process.argv[2];
if (!caminho) {
  console.error("Uso: bun run src/scripts/autorizar-agenda.ts <caminho-do-client_secret.json>");
  process.exit(1);
}

const bruto = JSON.parse(readFileSync(caminho.replace(/^~/, process.env["HOME"] ?? ""), "utf-8"));
const cfg = bruto.installed ?? bruto.web;
if (!cfg?.client_id || !cfg?.client_secret) {
  console.error("JSON não parece ser de um cliente OAuth (faltou client_id/client_secret).");
  process.exit(1);
}

const redirect = `http://localhost:${PORTA}`;
const oauth = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, redirect);

const url = oauth.generateAuthUrl({
  access_type: "offline",   // sem isso não vem refresh_token
  prompt: "consent",        // força o refresh_token mesmo se já houve consentimento antes
  scope: ESCOPOS,
});

console.log("\nAbra este link no navegador, logado como contato@csiacademy.com.br:\n");
console.log(url + "\n");

const codigo: string = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", redirect);
    const code = u.searchParams.get("code");
    const erro = u.searchParams.get("error");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<body style="font-family:system-ui;padding:3rem;text-align:center">
       <h2>${code ? "Autorizado ✅" : "Falhou ❌"}</h2>
       <p>${code ? "Pode fechar esta aba e voltar ao terminal." : erro ?? "sem código"}</p></body>`,
    );
    server.close();
    code ? resolve(code) : reject(new Error(erro ?? "sem código"));
  });
  server.listen(PORTA, () => console.log(`Aguardando o retorno em ${redirect} ...`));
  setTimeout(() => { server.close(); reject(new Error("tempo esgotado (20 min)")); }, 20 * 60_000);
});

const { tokens } = await oauth.getToken(codigo);
if (!tokens.refresh_token) {
  console.error("\n⚠️  Veio sem refresh_token. Revogue o acesso do app em https://myaccount.google.com/permissions e rode de novo.");
  process.exit(1);
}

// IMPRIME O TOKEN ANTES DE QUALQUER CHAMADA DE TESTE.
// Na primeira tentativa o teste falhou com 403 (Calendar API não habilitada) e o processo morreu
// levando junto o refresh_token recém-emitido — obrigando a refazer o consentimento à toa.
console.log("\n─── cole no .env e no Coolify ───\n");
console.log(`GOOGLE_OAUTH_CLIENT_ID=${cfg.client_id}`);
console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${cfg.client_secret}`);
console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);

// Teste: lista as agendas visíveis. Falha aqui NÃO invalida o token acima.
oauth.setCredentials(tokens);
try {
  const cal = google.calendar({ version: "v3", auth: oauth });
  const lista = await cal.calendarList.list({ maxResults: 20 });
  console.log("\nAgendas visíveis para esta autorização:");
  for (const c of lista.data.items ?? []) {
    console.log(`  ${(c.accessRole ?? "").padEnd(6)} ${c.primary ? "(principal) " : ""}${c.summary}  →  ${c.id}`);
  }
} catch (e) {
  console.log("\n⚠️  Token OK, mas a leitura da agenda falhou:", (e as Error).message.slice(0, 200));
}
console.log("");
