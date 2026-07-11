const fs = require('fs');

async function askOllama(prompt, contextText = '') {
  const fullPrompt = contextText ? `${contextText}\n\n${prompt}` : prompt;
  const startTime = Date.now();
  
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hermes3:8b",
        prompt: fullPrompt,
        stream: false,
        options: {
            num_ctx: 4096 // Limitando pro teto seguro da GTX 1660 Super
        }
      })
    });

    if (!response.ok) {
      return `[ERROR] HTTP ${response.status}: ${await response.text()}`;
    }

    const data = await response.json();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const tps = (data.eval_count / (data.eval_duration / 1e9)).toFixed(2);
    
    return `Tempo: ${duration}s | Velocidade: ${tps} tokens/s\n\nResposta:\n${data.response}`;
  } catch (err) {
    return `[ERROR] Falha de conexão: ${err.message}`;
  }
}

async function runTests() {
  console.log("==========================================");
  console.log("🔥 INICIANDO HARNESS TEST NO HERMES 3 8B 🔥");
  console.log("==========================================\n");

  // TESTE 1: Lógica
  console.log("------------------------------------------");
  console.log("TESTE 1: Lógica e Raciocínio (Maçãs)");
  console.log("------------------------------------------");
  const p1 = "Tenho 3 maçãs. Dou 1 para o meu irmão. Vou ao mercado e compro mais 5. Em seguida, pego 2 das minhas maçãs e corto ao meio para fazer uma torta. Quantas maçãs inteiras sobraram na minha mão? Seja super direto.";
  console.log(await askOllama(p1));
  console.log("\n");

  // TESTE 2: Código
  console.log("------------------------------------------");
  console.log("TESTE 2: Geração de Código Limpo");
  console.log("------------------------------------------");
  const p2 = "Escreva um script curto em Python que faz um ping em 'google.com' usando a biblioteca os. Apenas o código, sem explicações.";
  console.log(await askOllama(p2));
  console.log("\n");

  // TESTE 3: Estresse de Memória (Contexto Grande)
  console.log("------------------------------------------");
  console.log("TESTE 3: Leitura e Resumo (Estresse de RAM)");
  console.log("------------------------------------------");
  // Gera um texto falso grande para preencher 4096 tokens
  let contextGiant = "O lançamento oficial do Hermes 3 ocorreu em agosto de 2024. A equipe da Nous Research focou em criar um modelo com habilidades excepcionais em raciocínio, alinhamento flexível e function calling. ";
  contextGiant = contextGiant.repeat(100); // 100 repeticoes cria um bloco adequado para 4k tokens.
  const p3 = "Com base no longo texto fornecido acima, responda: Quem lançou o Hermes 3 e em que mês/ano? Responda em uma única frase.";
  console.log(await askOllama(p3, contextGiant));
  console.log("\n");
  
  console.log("==========================================");
  console.log("✅ HARNESS TEST FINALIZADO ✅");
  console.log("==========================================");
}

runTests();
