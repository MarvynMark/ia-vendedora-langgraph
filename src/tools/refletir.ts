import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const refletir = tool(
  async (input) => {
    return input.thought;
  },
  {
    name: "Refletir",
    description:
      "Use essa ferramenta para refletir sobre algo. Ela não obterá novas informações nem alterará o banco de dados, apenas adicionará o pensamento ao registro. Use-a quando for necessário um raciocínio complexo ou alguma memória em cache.",
    schema: z.object({
      thought: z.string().describe("O pensamento a ser registrado"),
    }),
  },
);
