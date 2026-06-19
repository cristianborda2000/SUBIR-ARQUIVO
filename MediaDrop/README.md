# MediaDrop

MediaDrop e um sistema web independente para receber arquivos pelo navegador e organizar automaticamente o armazenamento local por tipo de midia.

## Recursos

- Upload publico de multiplos arquivos
- Area de arrastar e soltar arquivos
- Campo opcional de observacao por envio
- Barra de progresso no navegador
- Conversao automatica de videos para MP4
- Upload de video por link do YouTube com salvamento em MP4
- Edicao do nome final dos arquivos antes do envio
- Organizacao automatica em `uploads/fotos`, `uploads/videos`, `uploads/audios`, `uploads/documentos` e `uploads/outros`
- Painel administrativo com login e senha
- Listagem por categoria com nome, tamanho, tipo e data de envio
- Download individual
- Download de categoria em ZIP
- Download geral em ZIP
- Exclusao de arquivos individuais ou de todos os arquivos
- Troca de senha do administrador pelo painel
- Metadados em SQLite
- Bloqueio de extensoes perigosas como `.exe`, `.bat`, `.sh`, `.php`, `.js` e similares

## Requisitos

- Node.js 20 ou superior
- npm

## Como rodar localmente

1. Entre na pasta do projeto:

```bash
cd MediaDrop
```

2. Instale as dependencias:

```bash
npm install
```

3. Copie o arquivo de ambiente:

```bash
copy .env.example .env
```

No macOS/Linux:

```bash
cp .env.example .env
```

4. Edite o arquivo `.env` e troque pelo menos:

```env
SESSION_SECRET=um-segredo-grande-e-aleatorio
ADMIN_USER=admin
ADMIN_PASSWORD=uma-senha-forte
MAX_FILE_SIZE_MB=200
```

5. Inicie o servidor:

```bash
npm start
```

6. Acesse:

- Upload publico: `http://localhost:3000`
- Painel administrativo: `http://localhost:3000/admin`

## Desenvolvimento

Para reiniciar automaticamente ao alterar arquivos:

```bash
npm run dev
```

Para validar o fluxo basico:

```bash
npm run smoke
```

Para validar a conversao de video para MP4:

```bash
npm run test:video
```

## Estrutura

```text
MediaDrop/
  public/
    index.html
    admin.html
    styles.css
    app.js
    admin.js
  src/
    config.js
    db.js
    server.js
    storage.js
  uploads/
    fotos/
    videos/
    audios/
    documentos/
    outros/
  data/
    mediadrop.sqlite
```

As pastas `uploads` e `data` sao criadas automaticamente na primeira execucao.

## Credenciais iniciais

Se voce nao criar um `.env`, o sistema usa:

- Usuario: `admin`
- Senha: `admin123`

Troque esses valores antes de usar fora do ambiente local.

## Limite de arquivo

O limite padrao e `200 MB` por arquivo. Altere em `.env`:

```env
MAX_FILE_SIZE_MB=500
```

## Conversao de videos

Videos enviados em formatos como WebM, MOV, AVI, MKV, MPEG e M4V sao convertidos automaticamente para MP4 usando FFmpeg embutido pela dependencia `ffmpeg-static`.

Enquanto a conversao acontece, o upload pode demorar um pouco mais em arquivos grandes. Ao finalizar, o painel administrativo mostra e baixa o arquivo ja com extensao `.mp4`.

## Videos do YouTube

Para baixar links do YouTube, instale o `yt-dlp` no PATH do sistema ou coloque o executavel em:

```text
MediaDrop/tools/yt-dlp.exe
```

O executavel local nao e enviado ao GitHub. Baixe a versao oficial em:

```text
https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
```

## Observacoes de seguranca

Este projeto foi pensado para uso local ou rede interna. Para publicar na internet, use HTTPS, uma senha forte, um `SESSION_SECRET` forte, backup do banco SQLite e regras de firewall/proxy adequadas.
