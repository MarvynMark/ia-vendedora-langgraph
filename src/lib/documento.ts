// Formatação de CPF/CNPJ para exibição nos alertas.
//
// Cada plataforma de pagamento envia o documento num formato: a DMGuru manda só
// dígitos ("07512345622", campo `contact.doc`) e a TMB manda já pontuado
// ("069.242.814-00", campo `documento`). Normalizamos na saída para o grupo ler
// sempre no mesmo formato.
export function formatarDocumento(bruto?: string): string {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length === 11) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digitos.length === 14) return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  // Fora desses dois tamanhos, mostrar o valor bruto é melhor do que esconder:
  // o time consegue conferir o cadastro mesmo com o dado torto.
  return bruto?.trim() || "(não informado)";
}
