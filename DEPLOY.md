# 🚀 Publicar o CarouselMed (link público permanente)

Este guia coloca o app no ar com um **link real** (ex: `https://carouselmed.onrender.com`)
que funciona em qualquer celular/PC, e os **links de compartilhamento** passam a ser públicos.

O projeto já está pronto para deploy:
- ✅ Fontes empacotadas em `fonts/` (não depende do Windows)
- ✅ Puppeteer configurado para Chromium do servidor (`Dockerfile`)
- ✅ Dados (rascunhos/imagens) em disco persistente via `DATA_DIR`

---

## Opção recomendada: Render (com Docker)

### 1. Subir o código para o GitHub
1. Crie uma conta grátis no [github.com](https://github.com).
2. Crie um repositório novo (ex: `carouselmed`), **privado**.
3. No terminal, dentro da pasta `carouselmed`:
   ```bash
   git init
   git add .
   git commit -m "CarouselMed"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/carouselmed.git
   git push -u origin main
   ```
   > O `.gitignore` já exclui `node_modules`, `.env`, `uploads`, `output` e `designs`.

### 2. Criar o serviço no Render
1. Crie conta grátis em [render.com](https://render.com) (pode logar com o GitHub).
2. **New → Blueprint** → conecte o repositório `carouselmed`.
   O Render lê o `render.yaml` automaticamente.
3. Em **Environment**, cole sua **GEMINI_API_KEY** (a mesma do `.env`).
   (Opcional: `POLLINATIONS_TOKEN` para imagens grátis.)
4. Clique **Apply / Create**. O Render builda o Docker e publica.
5. Em ~3-5 min você recebe a URL pública, ex: `https://carouselmed.onrender.com`.

### 3. Pronto!
- Acesse a URL em qualquer dispositivo.
- O botão **🔗 Compartilhar** agora gera links **públicos** (`https://carouselmed.onrender.com/?d=...`)
  que qualquer pessoa abre, edita e salva.

---

## Sobre os planos

| Plano Render | Custo | Persistência |
|---|---|---|
| **Free** | grátis | ⚠️ Os rascunhos/imagens **zeram** a cada novo deploy e o app "dorme" após inatividade. Bom para testar. |
| **Starter** | ~US$7/mês | ✅ Disco persistente de 1GB (no `render.yaml`). Rascunhos e imagens **ficam salvos** para sempre. Recomendado. |

> Para usar o **Free** primeiro: troque `plan: starter` por `plan: free` no `render.yaml` e remova o bloco `disk:`.

---

## Alternativas
- **Railway** ([railway.app](https://railway.app)): também via Docker, com volume persistente. Conecte o repo, adicione um Volume montado em `/data`, e a env `DATA_DIR=/data` + `GEMINI_API_KEY`.
- **Fly.io**: `fly launch` detecta o Dockerfile; crie um volume e monte em `/data`.

---

## Rodar local (continua funcionando)
```bash
npm install
# coloque GEMINI_API_KEY no arquivo .env
node server.js   # http://localhost:3001
```
