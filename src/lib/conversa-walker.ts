// Conversa de quem recebe os roteiros e mensagens para o aluno (vídeo da compra, texto do DIM).
// Por ID de conversa, não por telefone: o contato do Gusthavo está gravado sem o nono dígito
// (+556281384100), a busca pelo número com 9 não acha ninguém e a criação de conversa nova é
// recusada (404). Desde 09/10/2026 é a conversa 4160 (Professor Walker, +55 62 9602-0747,
// #02 Suporte); antes era a 1770, do Gusthavo, para testes.
export const CONVERSA_WALKER_ID = Number(process.env["DIAGNOSTICO_DESTINO_CONVERSA_ID"] ?? "4160");
