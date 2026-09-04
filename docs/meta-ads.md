# Acesso à Meta Marketing API (relatórios de mídia)

Para que `bun run meta` funcione, o `.env` precisa de duas variáveis:

```
META_ACCESS_TOKEN=EAAG...
META_AD_ACCOUNT_ID=act_123456789
```

Por que vale a pena: a Meta sabe quanto cada campanha **custou**; a planilha de aplicação
(`utm_campaign`) sabe quem **comprou**. Juntando os dois sai o **CAC real por campanha**, que é
diferente do custo por lead do painel — a `[LEADS][PCDF]-[LP]` entregava lead a R$ 1,71 e converteu
2,0% (zero vendas em julho e agosto de 2026).

## Opção A — token de teste (rápido, expira em ~1-2h)

Serve para rodar o relatório agora e ver se está tudo certo.

1. Abra o **Graph API Explorer**: https://developers.facebook.com/tools/explorer/
2. Em **Meta App**, escolha o app (ex.: *vestigium*).
3. Em **Permissions**, adicione `ads_read`.
4. Clique em **Generate Access Token** e autorize.
5. Copie o token para o `.env` em `META_ACCESS_TOKEN`.

## Opção B — token que não expira (recomendado para automação)

Um **usuário do sistema** do Business Manager gera um token permanente, que não quebra a cada 60
dias nem depende da sua sessão pessoal.

1. Abra o **Business Manager** → **Configurações do negócio**:
   https://business.facebook.com/settings/
2. Menu lateral: **Usuários** → **Usuários do sistema** → **Adicionar**.
   - Nome: `relatorios-ia` · Função: **Funcionário** (não precisa de admin).
3. Com ele selecionado, clique em **Adicionar ativos** → aba **Contas de anúncios** →
   marque a conta usada nos anúncios → permissão **Ver desempenho** (só leitura).
4. Clique em **Gerar novo token**:
   - App: o seu app (*vestigium*)
   - Permissões: marque **`ads_read`** (só isso; `ads_management` seria escrita)
   - Validade: **Nunca expira**
5. Copie o token — ele só aparece uma vez — e coloque no `.env`.

## Onde achar o `META_AD_ACCOUNT_ID`

- No **Gerenciador de Anúncios**, o número aparece na URL (`act=123456789`) e no seletor de conta.
- No `.env` ele vai **com o prefixo**: `act_123456789`.
- Ou, com o token já configurado, rode:
  ```bash
  curl -s "https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id&access_token=SEU_TOKEN"
  ```

## Segurança

- O token dá acesso de leitura aos dados de anúncios da conta. Trate como senha.
- Ele mora só no `.env` (que está no `.gitignore`) — nunca em commit, print ou chat.
- Use `ads_read`, nunca `ads_management`, para relatório: leitura não altera campanha nenhuma.
- Se vazar, revogue em **Configurações do negócio → Usuários do sistema → Tokens** (ou troque a
  senha da conta, no caso do token pessoal do Explorer).

## Usando

```bash
bun run meta                          # últimos 3 meses, por campanha e mês
bun run meta 2026-06-01 2026-08-31    # período específico
bun run meta 2026-08-01 2026-08-31 --dia
```

Se o token expirar, o script avisa com a mensagem de erro da própria Meta em vez de falhar seco.

## Skill `meta-ads-vestigium`

Existe uma skill que encapsula a operação da conta — subir anúncios, escolher criativo e
analisar desempenho — com as armadilhas da API já mapeadas:

```bash
S=~/.claude/skills/meta-ads-vestigium/scripts

bun run $S/analisar-criativos.ts acervo 15     # top publicações do @peritowalker p/ impulsionar
bun run $S/analisar-criativos.ts ativos 30     # desempenho dos anúncios no ar
bun run $S/analisar-criativos.ts publicos 90   # custo por lead por público
bun run $S/subir-anuncios.ts <adset_id> <media_id>:<NOME> ...   # sobe PAUSADO
```

Ela documenta o formato de criativo que funciona para promover post existente do Instagram
(descoberto por tentativa e erro), a contagem correta de leads (a Meta triplica o mesmo lead
em três chaves), e o comportamento do rate limit — que devolve leitura vazia em vez de erro.
