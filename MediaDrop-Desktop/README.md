# MediaDrop Admin Desktop

Aplicativo desktop para administrar o MediaDrop no PC.

Ele abre uma janela propria, conecta no Supabase para ver links do YouTube pendentes, conecta no MediaDrop web com usuario e senha de admin, e baixa tudo para uma pasta do computador.

## Rodar em desenvolvimento

```powershell
npm install
npm start
```

## Gerar instalador

```powershell
npm run build
```

O instalador fica em `dist`.

## Configuracao

No primeiro uso, abra a engrenagem dentro do app e preencha:

- URL do Supabase
- Secret key do Supabase
- URL do MediaDrop
- Usuario admin
- Senha admin
- Pasta de downloads

O arquivo real de configuracao fica na pasta de dados do usuario do Windows, fora do Git.
