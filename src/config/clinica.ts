export const clinica = {
  nome: "Clínica Moreira",
  endereco: "Rua das Flores, 123 – Centro, São Paulo/SP",
  telefone: "(11) 9999-9999",
  horario: {
    semana: "08h às 19h",
    sabado: "08h às 11h",
    domingo: "Fechado",
  },
  pagamento: ["PIX", "dinheiro", "cartão (débito/crédito)"],
  convenios: ["Bradesco Saúde", "Unimed", "SulAmérica", "Amil"],
  procedimentos: [
    { id: "avaliacao", nome: "Avaliação inicial", duracao: 30, valor: "Gratuita" },
    { id: "limpeza", nome: "Limpeza dental (profilaxia)", duracao: 45, valor: "A partir de R$ 350" },
    { id: "clareamento", nome: "Clareamento", duracao: 60, valor: "A partir de R$ 800" },
    { id: "restauracao", nome: "Restauração", duracao: 45, valor: "A partir de R$ 200" },
    { id: "canal", nome: "Canal (endodontia)", duracao: 90, valor: "A partir de R$ 600" },
    { id: "implante", nome: "Implante unitário", duracao: 120, valor: "A partir de R$ 3.000" },
    { id: "ortodontia", nome: "Ortodontia (aparelho)", duracao: 45, valor: "A partir de R$ 250/mês" },
    { id: "extracao", nome: "Extração simples", duracao: 30, valor: "A partir de R$ 180" },
  ],
} as const;
