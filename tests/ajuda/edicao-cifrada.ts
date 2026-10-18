import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Monta, para teste, o envelope de uma edicao cifrada: o INVERSO do que o produto faz. O teste cifra e o produto decifra; a
 * tag do AES-GCM e o oraculo da derivacao. O texto claro do teste e um JSON (o decodificador injetado o le de volta); em
 * producao e um protobuf, que so o portao da biblioteca sabe ler.
 */
export function segredoSintetico(): Buffer {
  return randomBytes(32);
}

export function cifrarEdicao(a: {
  segredo: Buffer;
  idOriginal: string;
  /** O endereco como o envelope traz, usado nos dois campos da derivacao (remetente da original = editor). */
  editor: string;
  /** O texto claro: um objeto (o decodificador de teste le o JSON) ou os bytes do protobuf. */
  claro: Record<string, unknown> | Buffer;
}): { encIv: string; encPayload: string } {
  const extraida = createHmac('sha256', Buffer.alloc(32, 0)).update(a.segredo).digest();
  const info = Buffer.concat([
    Buffer.from(a.idOriginal),
    Buffer.from(a.editor),
    Buffer.from(a.editor),
    Buffer.from('Message Edit'),
    Buffer.from([1]),
  ]);
  const chave = createHmac('sha256', extraida).update(info).digest();
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifra.update(Buffer.isBuffer(a.claro) ? a.claro : Buffer.from(JSON.stringify(a.claro))), cifra.final()]);
  return { encIv: iv.toString('base64'), encPayload: Buffer.concat([dados, cifra.getAuthTag()]).toString('base64') };
}

/** O decodificador de teste: le de volta o JSON que `cifrarEdicao` cifrou. */
export function decodificadorDeTeste(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
}
