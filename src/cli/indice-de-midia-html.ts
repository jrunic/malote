/**
 * O HTML do Indice de Midia. Autocontido (sem script, sem folha externa, sem imagem), deterministico (nenhum instante de
 * geracao: duas execucoes sobre o mesmo Acervo dao o mesmo arquivo) e SEM o texto da Mensagem nem miniatura. E dado
 * pessoal: o nome da Conversa e os links; quem o grava o protege como tal.
 */

export type SituacaoDaMidia = 'no-remoto' | 'no-remoto-sem-link' | 'pendente-de-envio' | 'so-no-disco' | 'nao-obtido' | 'descartado';

export interface LinhaDoIndice {
  rotulo: string;
  tipo: string;
  tamanho: number | null;
  situacao: SituacaoDaMidia;
  /** O id do arquivo no remoto, quando ha: vira o link de visualizacao do Google Drive. */
  idNoRemoto: string | null;
}

const ROTULO_DA_SITUACAO: Record<SituacaoDaMidia, string> = {
  'no-remoto': 'abrir',
  'no-remoto-sem-link': 'no armazenamento remoto (sem link)',
  'pendente-de-envio': 'pendente de envio',
  'so-no-disco': 'so no disco',
  'nao-obtido': 'nao obtido',
  descartado: 'descartado',
};

export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** O tamanho sem depender de locale: `123 B`, `4,5 KiB`... com ponto, para o HTML nao mudar de maquina para maquina. */
export function tamanhoLegivel(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < unidades.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${unidades[i]}`;
}

/** O endereco de visualizacao do Drive pelo id; `undefined` quando o id nao tem a forma de um id (nunca se monta URL com texto livre). */
export function linkDoDrive(idNoRemoto: string): string | undefined {
  return /^[A-Za-z0-9_-]{10,200}$/.test(idNoRemoto) ? `https://drive.google.com/file/d/${idNoRemoto}/view` : undefined;
}

export function montarHtmlDoIndice(titulo: string, linhas: readonly LinhaDoIndice[]): string {
  const corpo = linhas
    .map((l) => {
      const link = l.situacao === 'no-remoto' && l.idNoRemoto !== null ? linkDoDrive(l.idNoRemoto) : undefined;
      const celula =
        link === undefined
          ? escaparHtml(l.situacao === 'no-remoto' ? ROTULO_DA_SITUACAO['no-remoto-sem-link'] : ROTULO_DA_SITUACAO[l.situacao])
          : `<a href="${escaparHtml(link)}" rel="noopener noreferrer">${ROTULO_DA_SITUACAO['no-remoto']}</a>`;
      return `<tr><td>${escaparHtml(l.rotulo)}</td><td>${escaparHtml(l.tipo)}</td><td>${escaparHtml(tamanhoLegivel(l.tamanho))}</td><td>${celula}</td></tr>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Indice de midia - ${escaparHtml(titulo)}</title>
<style>body{font-family:sans-serif;margin:1.5em}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3em .6em;text-align:left}</style>
</head>
<body>
<h1>Indice de midia - ${escaparHtml(titulo)}</h1>
<p>${linhas.length} midia(s). Este arquivo tem dado pessoal (o nome da conversa e os links do armazenamento remoto): guarde-o como tal.</p>
<table>
<thead><tr><th>Rotulo</th><th>Tipo</th><th>Tamanho</th><th>Arquivo</th></tr></thead>
<tbody>
${corpo}
</tbody>
</table>
</body>
</html>
`;
}
