# MediaDrop Downloader

Baixador local dos links do YouTube enviados pelo MediaDrop e salvos no Supabase.

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

Os videos ficam na pasta `downloads`.
