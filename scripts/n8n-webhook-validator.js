// n8n Code Node — validação HMAC (rejeita o que não for assinado por nós)
// Cole este código no nó "Code" no n8n após o Webhook, antes de processar.
// Garante que o evento de handoff publicado no Redis foi enviado de fonte segura.

const crypto = require('crypto');
const sig = $request.headers['x-signature'];
const body = JSON.stringify($json);
const expected = 'sha256=' + crypto.createHmac('sha256', $env.WEBHOOK_SECRET).update(body).digest('hex');

if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
  throw new Error('Assinatura inválida — payload rejeitado');
}

// Retorne o fluxo adiante, agora seguro
return $input.all();
