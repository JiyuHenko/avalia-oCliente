# Leopoldina · Avaliação de materiais

Site estático para revisar as duas direções da Joias Leopoldina. Galeria, seleção rápida por gesto/botões, notas de 1 a 5 em passos de 0,5, comentários e parecer geral. Todos os campos são opcionais.

## Dados e privacidade

- As respostas ficam no `localStorage` deste navegador, sob uma chave específica do projeto. Não há banco de dados, conta, analytics ou envio automático das avaliações.
- A cliente deve baixar o JSON e enviá-lo ao responsável pelo projeto. O JSON inclui todos os códigos do catálogo; peças sem resposta ficam com campos nulos e `reviewed: false`.
- Importar permite mesclar ou substituir, após prévia. O mesmo site serve para o responsável ler e continuar uma avaliação importada.
- Apagar dados do navegador, usar outro aparelho/perfil ou mudar a origem do site pode remover ou separar o progresso. O JSON é o backup portátil.
- Os arquivos visuais são públicos no GitHub Pages. Somente as respostas permanecem no aparelho. Não adicionar feedback real de clientes ao repositório.

O formato está documentado em [docs/formato-json.md](docs/formato-json.md).

## Rodar localmente

Node.js 22 ou posterior. Nenhuma instalação é necessária para servir o site ou rodar os testes de estado.

```sh
npm run dev
npm test
npm run check
```

Abra a URL impressa pelo servidor. Sirva por HTTP; módulos JavaScript não devem ser abertos por `file://`.

O teste de navegador exige Playwright e Chrome/Chromium. Instale a ferramenta de desenvolvimento localmente (`npm install --no-save playwright`) ou defina `PLAYWRIGHT_MODULE` com o caminho de uma instalação existente, e execute `npm run test:browser`. Capturas e resultados ficam fora da pasta publicada.

## Publicação

O workflow `.github/workflows/pages.yml` verifica os arquivos e publica apenas `site/` a cada push para `main`. Nas configurações do repositório, a origem de Pages é **GitHub Actions**.

## Mídia e manutenção

São 74 imagens e 3 MP4 existentes, sem capas de vídeo como itens. IDs A01–A65, B01–B09 e V01–V03 são estáveis e ligam o JSON às artes. `site/catalog.js` descreve o catálogo; WebP completo e miniatura tornam a navegação mais leve. Os MP4 foram preservados.

`tools/prepare-assets.py` documenta a conversão técnica a partir do pacote original e de seu manifesto local. Não é necessário para executar/publicar o material já incluído. Os caminhos de origem locais podem ser informados por argumentos; não são usados pelo site.

Fontes EB Garamond e Inter sob OFL, com licenças em `site/media/fonts`. A assinatura e as imagens foram fornecidas/criadas para o projeto Leopoldina. Mockups são simulações conceituais, identificadas nas peças.
