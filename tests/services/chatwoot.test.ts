import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock global fetch before importing service
const mockFetch = mock(async () =>
  new Response(JSON.stringify({ id: 1 }), { status: 200 })
);

import {
  enviarMensagem,
  enviarArquivo,
  marcarComoLida,
  atualizarPresenca,
  atualizarAtributosConversa,
  adicionarEtiquetas,
  atualizarContato,
  listarMensagens,
  buscarMensagemPorId,
  buscarKanbanBoard,
  moverKanbanTask,
  removerEtiquetas,
  buscarConversa,
  registrarTextoMidia,
  limparTextosMidia,
  blocoDuplicaMidia,
  blocoNarraEnvioMidia,
  blocoNarraAcaoInterna,
  blocoTemFraseProibida,
  blocoEhNomeDeTool,
  blocoVazaJargaoInterno,
  obterTextosMidia,
  registrarTextoMidiaNaoEnviado,
  registrarSaidasRecentes,
  saidasRecentes,
} from "../../src/services/chatwoot.ts";

describe("chatwoot service", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ id: 1 }), { status: 200 })
    );
    globalThis.fetch = mockFetch as typeof fetch;
  });

  describe("enviarMensagem", () => {
    test("usa URL correta com account e conversation", async () => {
      await enviarMensagem("8", "100", "Olá");
      const [url] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/accounts/8/");
      expect(url as string).toContain("/conversations/100/messages");
    });

    test("envia content e message_type corretos", async () => {
      await enviarMensagem("8", "100", "Olá");
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.content).toBe("Olá");
      expect(body.message_type).toBe("outgoing");
    });

    test("lança erro em resposta não-ok após retries", async () => {
      mockFetch.mockImplementation(async () =>
        new Response("Internal Error", { status: 500 })
      );
      await expect(enviarMensagem("8", "100", "test")).rejects.toThrow("500");
    });
  });

  describe("marcarComoLida", () => {
    test("usa URL update_last_seen", async () => {
      await marcarComoLida("8", "100");
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/update_last_seen");
      expect(options!.method).toBe("POST");
    });
  });

  describe("atualizarPresenca", () => {
    test("envia typing_status=on quando typing=true", async () => {
      await atualizarPresenca("8", "100", true);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/toggle_typing_status");
      const body = JSON.parse(options!.body as string);
      expect(body.typing_status).toBe("on");
    });

    test("envia typing_status=off quando typing=false", async () => {
      await atualizarPresenca("8", "100", false);
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.typing_status).toBe("off");
    });

    test("envia typing_status=recording quando status='recording'", async () => {
      await atualizarPresenca("8", "100", "recording");
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.typing_status).toBe("recording");
    });
  });

  describe("atualizarAtributosConversa", () => {
    test("usa PATCH para conversa", async () => {
      await atualizarAtributosConversa("8", "100", { motivo_cancelamento: "desistência" });
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100");
      expect(options!.method).toBe("PATCH");
    });

    test("envia custom_attributes corretamente", async () => {
      await atualizarAtributosConversa("8", "100", { motivo_cancelamento: "desistência" });
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.custom_attributes.motivo_cancelamento).toBe("desistência");
    });
  });

  describe("adicionarEtiquetas", () => {
    test("busca labels existentes e faz merge antes de postar", async () => {
      // First call (buscarConversa) returns existing labels
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ labels: ["existente"] }), { status: 200 })
      );
      await adicionarEtiquetas("8", "100", ["teste-agente"]);

      // Second call is the POST to /labels with merged set
      const labelCall = mockFetch.mock.calls.find(c => {
        const [url, opts] = c as [string, RequestInit];
        return (url as string).includes("/conversations/100/labels") && opts?.method === "POST";
      });
      expect(labelCall).toBeDefined();
      const body = JSON.parse((labelCall as [string, RequestInit])[1]!.body as string);
      expect(body.labels).toContain("existente");
      expect(body.labels).toContain("teste-agente");
    });
  });

  describe("atualizarContato", () => {
    test("usa PATCH para contato", async () => {
      await atualizarContato("8", "42", { procedimento_interesse: null });
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/contacts/42");
      expect(options!.method).toBe("PATCH");
    });
  });

  describe("listarMensagens", () => {
    test("usa GET para listar mensagens da conversa", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ payload: [{ id: 1, content: "oi" }] }), { status: 200 })
      );
      const result = await listarMensagens("8", "100") as { payload: unknown[] };
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/messages");
      expect((options as RequestInit).method).toBe("GET");
      expect(result.payload).toHaveLength(1);
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(listarMensagens("8", "100")).rejects.toThrow("500");
    });
  });

  describe("buscarMensagemPorId", () => {
    test("retorna conteúdo via endpoint direto (caminho rápido)", async () => {
      // Direct endpoint succeeds
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ id: 42, content: "mensagem direta" }), { status: 200 })
      );
      const result = await buscarMensagemPorId("8", "100", 42);
      expect(result).toBe("mensagem direta");
      // Only one fetch call needed (direct endpoint)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("fallback para lista quando endpoint direto retorna 404", async () => {
      // Direct endpoint returns 404
      mockFetch.mockImplementationOnce(async () =>
        new Response("Not Found", { status: 404 })
      );
      // List endpoint returns all messages
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ payload: [
          { id: 1, content: "primeira" },
          { id: 42, content: "mensagem buscada" },
        ] }), { status: 200 })
      );
      const result = await buscarMensagemPorId("8", "100", 42);
      expect(result).toBe("mensagem buscada");
    });

    test("retorna null quando mensagem não encontrada na lista (fallback)", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Not Found", { status: 404 })
      );
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ payload: [{ id: 1, content: "outra" }] }), { status: 200 })
      );
      const result = await buscarMensagemPorId("8", "100", 99);
      expect(result).toBeNull();
    });

    test("retorna null em caso de erro", async () => {
      mockFetch.mockImplementationOnce(async () => {
        throw new Error("Network error");
      });
      const result = await buscarMensagemPorId("8", "100", 1);
      expect(result).toBeNull();
    });
  });

  describe("buscarConversa", () => {
    test("usa GET para buscar conversa", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ id: 100, labels: ["tag1"] }), { status: 200 })
      );
      const result = await buscarConversa("8", "100") as { id: number; labels: string[] };
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100");
      expect((options as RequestInit).method).toBe("GET");
      expect(result.id).toBe(100);
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Not Found", { status: 404 })
      );
      await expect(buscarConversa("8", "999")).rejects.toThrow("404");
    });
  });

  describe("buscarKanbanBoard", () => {
    test("usa GET para buscar kanban board", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ id: 1, name: "Board" }), { status: 200 })
      );
      await buscarKanbanBoard("8", "1");
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/kanban_boards/1");
      expect((options as RequestInit).method).toBe("GET");
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(buscarKanbanBoard("8", "1")).rejects.toThrow("500");
    });
  });

  describe("moverKanbanTask", () => {
    test("usa POST para mover task para novo step", async () => {
      await moverKanbanTask("8", "1", "42", 7);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/kanban_boards/1/kanban_tasks/42/move");
      expect((options as RequestInit).method).toBe("POST");
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.board_step_id).toBe(7);
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(moverKanbanTask("8", "1", "42", 7)).rejects.toThrow("500");
    });
  });

  describe("removerEtiquetas", () => {
    test("remove etiquetas e mantém as restantes", async () => {
      // buscarConversa returns labels ["tag1", "tag2", "tag3"]
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ labels: ["tag1", "tag2", "tag3"] }), { status: 200 })
      );
      // definirEtiquetas POST
      await removerEtiquetas("8", "100", ["tag2"]);

      const labelCall = mockFetch.mock.calls.find(c => {
        const [url, opts] = c as [string, RequestInit];
        return (url as string).includes("/conversations/100/labels") && opts?.method === "POST";
      });
      expect(labelCall).toBeDefined();
      const body = JSON.parse((labelCall as [string, RequestInit])[1]!.body as string);
      expect(body.labels).toContain("tag1");
      expect(body.labels).toContain("tag3");
      expect(body.labels).not.toContain("tag2");
    });
  });

  describe("enviarArquivo", () => {
    test("usa POST com FormData para enviar arquivo", async () => {
      const buffer = new Uint8Array([1, 2, 3]);
      await enviarArquivo("8", "100", buffer, "audio.mp3");
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/messages");
      expect((options as RequestInit).method).toBe("POST");
      expect((options as RequestInit).body).toBeInstanceOf(FormData);
    });

    test("inclui is_recorded_audio quando isRecordedAudio=true", async () => {
      const buffer = new Uint8Array([1]);
      await enviarArquivo("8", "100", buffer, "audio.mp3", "audio/mpeg", { isRecordedAudio: true });
      const formData = mockFetch.mock.calls[0]![1]!.body as FormData;
      expect(formData.get("is_recorded_audio")).toBe("true");
    });

    test("inclui attachment_metadata quando transcribedText fornecido", async () => {
      const buffer = new Uint8Array([1]);
      await enviarArquivo("8", "100", buffer, "audio.mp3", "audio/mpeg", { transcribedText: "olá" });
      const formData = mockFetch.mock.calls[0]![1]!.body as FormData;
      const meta = JSON.parse(formData.get("attachment_metadata") as string);
      expect(meta.transcribed_text).toBe("olá");
    });

    test("lança erro em resposta não-ok após retries", async () => {
      mockFetch.mockImplementation(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(enviarArquivo("8", "100", new Uint8Array([1]), "f.mp3")).rejects.toThrow("500");
    });
  });

  // Regressão da conversa 3995: depois de enviar o áudio 2, o LLM emitiu bolhas de narração
  // ("Vou te mandar agora", "Vou enviar o áudio para você") que a tool já havia enviado.
  // O filtro literal (blocoDuplicaMidia) não pegava porque não batem com o mensagem_antes.
  describe("filtro de narração de mídia (blocoNarraEnvioMidia)", () => {
    const conv = "3995";
    beforeEach(() => {
      limparTextosMidia(conv);
      // mensagem_antes real do áudio 2 registrado pela tool
      registrarTextoMidia(conv, "Gravei um áudio te mostrando como isso funciona na prática.");
    });

    test("filtra as narrações exatas que vazaram na 3995", () => {
      expect(blocoNarraEnvioMidia(conv, "Vou te mandar agora")).toBe(true);
      expect(blocoNarraEnvioMidia(conv, "Vou enviar o áudio para você")).toBe(true);
    });

    test("filtra outras paráfrases de envio de áudio/vídeo", () => {
      expect(blocoNarraEnvioMidia(conv, "Vou te enviar o áudio")).toBe(true);
      expect(blocoNarraEnvioMidia(conv, "Já te mando o vídeo")).toBe(true);
      expect(blocoNarraEnvioMidia(conv, "Vou te passar agora")).toBe(true);
    });

    test("NÃO filtra a pergunta legítima que fecha o turno de áudio", () => {
      expect(blocoNarraEnvioMidia(conv, "Você também sente isso na hora de estudar?")).toBe(false);
      expect(blocoNarraEnvioMidia(conv, "Quer que eu te mostre um vídeo rapidinho de como é a mentoria por dentro?")).toBe(false);
    });

    test("filtra a narração da imagem de entregáveis (agora vai via mensagem_antes)", () => {
      // A intro "vou te mandar uma imagem" agora é enviada pela tool como mensagem_antes;
      // se o LLM repetir no output, é duplicata e deve ser removida.
      expect(
        blocoNarraEnvioMidia(conv, "Então deixa eu te mostrar tudo que tá incluso, vou te mandar uma imagem e já te explico"),
      ).toBe(true);
      expect(blocoNarraEnvioMidia(conv, "Vou te mandar a imagem agora")).toBe(true);
    });

    test("NÃO filtra reação/pergunta longa sem narração de envio de mídia", () => {
      // Bloco longo que NÃO narra envio de mídia deve passar, mesmo em turno de mídia.
      expect(
        blocoNarraEnvioMidia(conv, "Além do acompanhamento comigo, você tem meu método gravado, encontros ao vivo e a comunidade de mentorados. O que você achou?"),
      ).toBe(false);
    });

    test("NÃO filtra narração fora de turno de mídia (sem mensagem_antes registrado)", () => {
      limparTextosMidia(conv);
      // Sem mídia neste turno: "vou te passar o link" (pagamento) deve passar
      expect(blocoNarraEnvioMidia(conv, "Vou te passar o link agora")).toBe(false);
      expect(blocoNarraEnvioMidia(conv, "Vou te mandar agora")).toBe(false);
    });
  });

  // Regressão da conversa 4153: a IA verbalizou pro lead a ação interna de Kanban
  // ("vou mover a tarefa para Aguardando Pagamento" + "E incluir o status na descrição").
  describe("filtro de narração de ação interna (blocoNarraAcaoInterna)", () => {
    test("filtra as narrações exatas que vazaram na 4153", () => {
      expect(blocoNarraAcaoInterna('Antes de prosseguir, vou mover a tarefa para "Aguardando Pagamento"')).toBe(true);
      expect(blocoNarraAcaoInterna("E incluir o status na descrição")).toBe(true);
    });

    test("filtra outras variações de operação de CRM", () => {
      expect(blocoNarraAcaoInterna("Vou atualizar o card com essas informações")).toBe(true);
      expect(blocoNarraAcaoInterna("Vou te mover para a etapa de Conexão")).toBe(true);
      expect(blocoNarraAcaoInterna("Deixa eu mudar de etapa aqui")).toBe(true);
    });

    test("NÃO filtra mensagens legítimas ao lead", () => {
      expect(blocoNarraAcaoInterna("Vou te passar o link de pagamento agora")).toBe(false);
      expect(blocoNarraAcaoInterna("Vou te mandar um áudio rapidinho")).toBe(false);
      expect(blocoNarraAcaoInterna("Vi que sua maior dificuldade é constância")).toBe(false);
      expect(blocoNarraAcaoInterna("Qual plano se encaixa melhor pra você?")).toBe(false);
      expect(blocoNarraAcaoInterna("Vou incluir Português e Direito Penal no seu plano de estudos")).toBe(false);
    });

    // Regressão da conversa 4171: nota interna em 3ª pessoa sobre a lead vazada como mensagem.
    test("filtra nota em 3ª pessoa sobre o lead (4171)", () => {
      expect(blocoNarraAcaoInterna("Conversei com Mylla, que está interessada na mentoria")).toBe(true);
      expect(blocoNarraAcaoInterna("Vamos retomar a conversa para ver o que podemos fazer no caso dela")).toBe(true);
    });

    test("NÃO filtra 'conversei com' sem nome próprio (ex.: financeiro)", () => {
      expect(blocoNarraAcaoInterna("Conversei com o time financeiro e consegui uma condição")).toBe(false);
    });
  });

  // Regressão da conversa 4154: nome literal da tool escrito como mensagem pro lead.
  describe("filtro de nome de ferramenta (blocoEhNomeDeTool)", () => {
    test("filtra os nomes de tool que vazaram na 4154", () => {
      expect(blocoEhNomeDeTool("Enviar_audio_walker_1")).toBe(true);
      expect(blocoEhNomeDeTool("Enviar_audio_walker_2")).toBe(true);
    });

    test("filtra outros nomes de tool", () => {
      expect(blocoEhNomeDeTool("Enviar_video_plataforma")).toBe(true);
      expect(blocoEhNomeDeTool("Enviar_imagem_entregaveis")).toBe(true);
      expect(blocoEhNomeDeTool("Atualizar_tarefa")).toBe(true);
    });

    test("NÃO filtra mensagens legítimas", () => {
      expect(blocoEhNomeDeTool("Vou te enviar um áudio rapidinho")).toBe(false);
      expect(blocoEhNomeDeTool("Qual plano se encaixa melhor pra você?")).toBe(false);
    });
  });

  // Regressão da conversa 4153: despedida com frases banidas pelo roteiro.
  describe("filtro de frases proibidas (blocoTemFraseProibida)", () => {
    test("filtra as despedidas banidas que vazaram na 4153", () => {
      expect(blocoTemFraseProibida("Boa sorte nos estudos e qualquer coisa, é só me chamar!")).toBe(true);
      expect(blocoTemFraseProibida("Fico à disposição quando você estiver pronto para dar o próximo passo")).toBe(true);
    });

    test("filtra variações (sem acento, fique à vontade)", () => {
      expect(blocoTemFraseProibida("estou a disposicao")).toBe(true);
      expect(blocoTemFraseProibida("Fique à vontade pra me chamar")).toBe(true);
    });

    test("NÃO filtra despedidas/mensagens legítimas", () => {
      expect(blocoTemFraseProibida("Tudo bem, Anibal, assim que estiver pronto é só me chamar")).toBe(false);
      expect(blocoTemFraseProibida("Qual plano se encaixa melhor pra você?")).toBe(false);
      expect(blocoTemFraseProibida("Tenha uma excelente tarde também!")).toBe(false);
    });

    test("filtra o jargão interno de venda vazado (blocoVazaJargaoInterno)", () => {
      // O fragmento literal do prompt que vazou na conv 5577
      expect(blocoVazaJargaoInterno("Isso derruba a barreira sem rebaixar a âncora")).toBe(true);
      expect(blocoVazaJargaoInterno("vou fazer um downsell pro Semestral")).toBe(true);
      expect(blocoVazaJargaoInterno("aqui entra a prova social dos alunos")).toBe(true);
      expect(blocoVazaJargaoInterno("é uma ancoragem de valor")).toBe(true);
      // Mensagens legítimas ao lead não são jargão interno
      expect(blocoVazaJargaoInterno("93% dos meus alunos passaram pras próximas fases")).toBe(false);
      expect(blocoVazaJargaoInterno("O plano Semestral fica em 12x de R$ 197")).toBe(false);
    });

    test("filtra os fechos passivos que vazaram na 4409 (fase de pagamento)", () => {
      expect(blocoTemFraseProibida("Se precisar de mais alguma coisa ou tiver dúvidas sobre o pagamento, estou aqui para ajudar!")).toBe(true);
      expect(blocoTemFraseProibida("Se tiver mais alguma dúvida ou precisar de ajuda com o pagamento, me avisa")).toBe(true);
      expect(blocoTemFraseProibida("Estou aqui para ajudar no que for preciso!")).toBe(true);
      expect(blocoTemFraseProibida("Se precisar de mais alguma coisa, é só me avisar!")).toBe(true);
      expect(blocoTemFraseProibida("Qualquer coisa, me chama")).toBe(true);
      expect(blocoTemFraseProibida("Conte comigo!")).toBe(true);
    });

    test("NÃO filtra CTAs ativos (ação concreta) nem respostas legítimas com 'se precisar'", () => {
      // CTAs ativos: pedem uma ação ligada ao próximo passo, sem abertura passiva
      expect(blocoTemFraseProibida("Me avisa quando finalizar!")).toBe(false);
      expect(blocoTemFraseProibida("Assim que finalizar, me avisa pra eu liberar tudo pra você")).toBe(false);
      expect(blocoTemFraseProibida("Me avisa quando cair o pagamento que eu já monto seu plano")).toBe(false);
      // "se precisar" numa resposta de conteúdo (sem verbo de oferta) não deve casar
      expect(blocoTemFraseProibida("Se precisar parcelar em mais vezes, dá pra fazer no link")).toBe(false);
    });
  });

  // Registro de texto de mídia (mensagem_antes): guarda o ORIGINAL pra persistir no histórico,
  // fechando a duplicação da conv 4700 (run concorrente repetia a etapa por não ver a mídia).
  describe("registro de texto de mídia (obterTextosMidia)", () => {
    test("guarda o texto ORIGINAL (com acento/pontuação) e retorna na ordem enviada", () => {
      limparTextosMidia("simc1");
      registrarTextoMidia("simc1", "Entendi. Vi que você é formado em Engenharia Química.");
      registrarTextoMidia("simc1", "Dá uma olhadinha no vídeo.");
      expect(obterTextosMidia("simc1")).toEqual([
        "Entendi. Vi que você é formado em Engenharia Química.",
        "Dá uma olhadinha no vídeo.",
      ]);
    });

    test("limparTextosMidia zera também os originais", () => {
      registrarTextoMidia("simc2", "Texto de mídia");
      limparTextosMidia("simc2");
      expect(obterTextosMidia("simc2")).toEqual([]);
    });

    test("blocoDuplicaMidia continua funcionando após guardar o original", () => {
      limparTextosMidia("simc3");
      registrarTextoMidia("simc3", "Vou te mostrar tudo que está incluso!");
      // normalizarTextoMidia remove pontuação e baixa a caixa, mas NÃO remove acento.
      expect(blocoDuplicaMidia("simc3", "vou te mostrar tudo que está incluso")).toBe(true);
    });

    // Fix do #3: numa run concorrente, o limparTextosMidia do início zera o registro do turno e a
    // tool (deduped) não re-registra — o registro PERSISTENTE segura pra ainda filtrar a cópia.
    test("blocoDuplicaMidia pega a apresentação MESMO após limparTextosMidia (dedup cross-run)", () => {
      limparTextosMidia("simc4");
      registrarTextoMidia("simc4", "Entendi. Vi que você é formado em Engenharia Química.");
      limparTextosMidia("simc4"); // simula o começo da run concorrente
      expect(blocoDuplicaMidia("simc4", "vi que você é formado em Engenharia Química")).toBe(true);
    });

    test("registrarTextoMidiaNaoEnviado entra no filtro mas NÃO no histórico", () => {
      limparTextosMidia("simc5");
      registrarTextoMidiaNaoEnviado("simc5", "Vou te mostrar tudo que está incluso!");
      expect(obterTextosMidia("simc5")).toEqual([]);
      expect(blocoDuplicaMidia("simc5", "vou te mostrar tudo que está incluso")).toBe(true);
    });
  });

  // Duplicação da conv 5385: o LLM repetiu no output o mesmo conteúdo que já tinha ido no
  // mensagem_antes, mas PARAFRASEADO ("Acabei de ver que" → "Vi que"). A comparação por substring
  // exata deixava passar; por isso blocoDuplicaMidia hoje usa similaridade por trigramas.
  describe("blocoDuplicaMidia tolerante a paráfrase (conv 5385)", () => {
    const ANTES_5385 =
      "Acabei de ver que você é formado em Medicina e que essa é a primeira vez que está estudando para concursos. Isso é mais comum do que parece, e quase nunca é falta de esforço.";

    beforeEach(() => {
      limparTextosMidia("c5385");
      registrarTextoMidia("c5385", ANTES_5385);
    });

    test("pega a paráfrase que vazava ('Vi que' vs 'Acabei de ver que')", () => {
      expect(
        blocoDuplicaMidia(
          "c5385",
          "Vi que você é formado em Medicina e que essa é a primeira vez que está estudando para concursos.",
        ),
      ).toBe(true);
    });

    test("continua pegando a frase idêntica", () => {
      expect(
        blocoDuplicaMidia("c5385", "Isso é mais comum do que parece, e quase nunca é falta de esforço."),
      ).toBe(true);
    });

    test("frase curta de validação NÃO é filtrada por aqui", () => {
      // "Ótimo, Luiz!" é ruído, mas quem remove é blocoTemFraseProibida — não este filtro.
      expect(blocoDuplicaMidia("c5385", "Ótimo, Luiz!")).toBe(false);
    });

    test("não filtra perguntas legítimas do roteiro (falso-positivo)", () => {
      const legitimas = [
        "Você também sente isso na hora de estudar?",
        "E hoje, quanto tempo por dia você consegue estudar de verdade?",
        "Você já tentou montar um cronograma sozinho?",
      ];
      for (const f of legitimas) {
        expect(blocoDuplicaMidia("c5385", f)).toBe(false);
      }
    });
  });

  // Conv 5525: o mesmo texto reapareceu com uma palavra a mais ("bem mais comum").
  describe("blocoDuplicaMidia com inserção de palavra (conv 5525)", () => {
    test("'bem mais comum' vs 'mais comum' é repetição", () => {
      limparTextosMidia("c5525");
      registrarTextoMidia(
        "c5525",
        "Isso é bem mais comum do que parece, e quase nunca é falta de esforço",
      );
      expect(
        blocoDuplicaMidia("c5525", "Isso é mais comum do que parece, e quase nunca é falta de esforço"),
      ).toBe(true);
    });
  });

  describe("saidasRecentes", () => {
    test("devolve o que foi registrado + as apresentações de mídia do processo", () => {
      limparTextosMidia("c-saidas");
      registrarSaidasRecentes("c-saidas", ["Oi, aqui é o Perito Walker", "Posso te mostrar?"]);
      registrarTextoMidia("c-saidas", "Dá uma olhada no que eu tenho pra te dizer.");
      const s = saidasRecentes("c-saidas");
      expect(s).toContain("Oi, aqui é o Perito Walker");
      expect(s).toContain("Dá uma olhada no que eu tenho pra te dizer.");
    });

    test("ignora vazios e limita o tamanho", () => {
      registrarSaidasRecentes("c-saidas2", ["  ", "a", "b", "c", "d", "e", "f", "g"]);
      const s = saidasRecentes("c-saidas2");
      expect(s).not.toContain("  ");
      expect(s.length).toBeLessThanOrEqual(6);
    });

    test("conversa sem registro devolve lista vazia", () => {
      expect(saidasRecentes("c-inexistente")).toEqual([]);
    });
  });
});
