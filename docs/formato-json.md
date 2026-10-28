# Arquivo de avaliação

O site salva a avaliação no navegador e exporta um JSON UTF-8. Nada deste módulo envia os dados para servidores. O arquivo exportado é a cópia que a cliente pode encaminhar ao responsável pelo projeto.

## Identificação

- `format`: `leopoldina-client-review`.
- `schemaVersion`: `1`.
- `project.id`: `joias-leopoldina`.
- `project.catalogVersion`: `1`.
- `exportedAt` e `updatedAt`: datas ISO 8601.
- `reviewer.name`: nome opcional.
- `overview.direction`: `A`, `B`, `mix` ou `null`.
- `overview.comment`: comentário geral opcional.
- `summary`: contagem de respostas, notas e escolhas; é recalculada pelo site na importação.
- `items`: lista de todas as peças do catálogo, inclusive as sem resposta.

Cada peça tem `id`, `title`, `direction`, `category`, `type` e `asset`, seguidos dos campos de avaliação:

```json
{
  "id": "B01",
  "title": "Cartão 10x7 cm - frente",
  "direction": "B",
  "category": "papelaria",
  "type": "image",
  "asset": "./media/full/B01.webp",
  "rating": 3.5,
  "decision": "adjust",
  "comment": "Gostei do cartão; quero a logo um pouco maior.",
  "updatedAt": "2026-10-28T15:20:00.000Z",
  "decisionLabel": "Quero ajustar",
  "reviewed": true
}
```

`rating` aceita `null` ou números de `1` a `5`, em intervalos de meia estrela, como `1.5` e `3.5`. Uma peça sem nota não recebe zero nem uma estrela por padrão; ela permanece com `null` até uma ação explícita de avaliação. `decision` aceita `keep` (quero usar), `adjust` (quero ajustar), `discard` (prefiro não usar) ou `null` (sem escolha). `comment` pode ficar vazio. É possível avaliar só uma dessas informações em uma peça e deixar todas as demais sem resposta.

Vídeos são registros normais com `type: video`. Sua capa não recebe uma avaliação separada. Os IDs `V01`, `V02` e `V03` pertencem à direção A, pois estes são os vídeos existentes.

## Importação

A importação aceita arquivos deste formato, deste projeto e da versão atual do catálogo. O limite é 4 MB, com até 10 mil caracteres por comentário e 200 caracteres para o nome. Notas inválidas, IDs duplicados e propriedades inseguras são rejeitados. Códigos desconhecidos são ignorados com um aviso.

Títulos, caminhos de arquivos e o resumo vindos do JSON não são usados para renderizar mídias ou HTML. A interface sempre usa o catálogo local conhecido. Comentários são apenas texto e devem ser exibidos com `textContent`/`value`.

Ao combinar avaliações, as respostas existentes permanecem quando a cópia importada não contém resposta para aquela peça. Uma resposta importada substitui o registro anterior daquela peça. Limpezas explícitas de respostas, que possuem `updatedAt`, também são preservadas. Nome e preferências gerais não vazios da cópia importada substituem os atuais. A opção de substituir tudo restaura a sessão importada por completo e deve ser confirmada na interface.

## Persistência e recuperação

A chave é `leopoldina-review:joias-leopoldina:v1`. A chave com sufixo `:backup` mantém a versão anterior válida. O estado local contém somente dados de avaliação; imagens e vídeos são arquivos estáticos do site.

Falhas de armazenamento são retornadas explicitamente. Se o conteúdo principal estiver corrompido, a leitura tenta recuperar o backup, mas preserva o conteúdo original e bloqueia sua sobrescrita automática. A interface deve oferecer exportação da sessão recuperada e uma ação explícita de limpeza/restauração. `clearSession` deve ser chamado somente após essa confirmação.

`loadSession` retorna `{ ok, status, session, warning, writeBlocked }`. `saveSession` retorna `{ ok, status, warning, writeBlocked }`, com `session` normalizada quando salva. `parseReview` retorna `{ session, unknownIds, warnings }` ou lança `ReviewValidationError` com mensagem legível e código de erro.
