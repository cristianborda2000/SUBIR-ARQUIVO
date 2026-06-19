# MediaDrop Downloader

Painel local para baixar no computador os links do YouTube enviados pelo MediaDrop e salvos no Supabase.

## Como usar

1. Copie `config.example.json` para `config.json`.
2. Preencha `supabaseUrl` e `supabaseServiceRoleKey`.
3. Coloque `yt-dlp.exe` em `tools/yt-dlp.exe` ou instale `yt-dlp` no PATH.
4. O FFmpeg pode ficar em `tools/ffmpeg.exe`; se o MediaDrop estiver na pasta ao lado, o baixador tambem usa o FFmpeg de `MediaDrop/node_modules/ffmpeg-static`.
5. Execute:

```bash
npm start
```

No Windows, tambem pode dar duplo clique em:

```text
Baixar-Pendentes.bat
```

Ao abrir, o aplicativo inicia um painel local no navegador com botoes para buscar, baixar e apagar links pendentes. Os videos ficam na pasta `downloads`.

## Atalhos do instalador

O instalador cria tres atalhos:

- `MediaDrop Admin`: abre o painel administrativo online no navegador.
- `MediaDrop Downloader`: abre o painel local para baixar videos neste computador.
- `MediaDrop Downloader - Config`: abre o arquivo `config.json`.

O baixador local busca os links pendentes no Supabase e baixa os videos no computador usando `yt-dlp` e `ffmpeg`.
