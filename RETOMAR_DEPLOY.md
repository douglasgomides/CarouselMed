# ▶️ Retomar o deploy (onde paramos)

## ✅ Já está feito
- Código no GitHub (privado): **https://github.com/alexoliveiradesign2021-dot/carouselmed**
- GitHub CLI autenticado (conta: alexoliveiradesign2021-dot)
- `render.yaml` configurado no **plano grátis**
- Conta Render criada (Alex Oliveira) e Blueprint detectado

## ⏭️ Falta só finalizar no Render (2 min)

1. Entre em **https://dashboard.render.com** → menu **Blueprints** → **New Blueprint Instance**
   (ou continue de onde parou: tela "You are deploying from a Blueprint for .../carouselmed")
2. Preencha:
   - **Blueprint Name:** `carouselmed`
   - **Branch:** `main` (já vem)
   - **Blueprint Path:** deixe vazio
   - **GEMINI_API_KEY** (Value): cole a chave do arquivo `.env` local
   - **POLLINATIONS_TOKEN:** deixe vazio
3. Clique **Deploy Blueprint** → aguarde o build (~5-8 min) → status **Live 🟢**
4. A URL pública aparece no topo, ex: **https://carouselmed.onrender.com**
   - Esse é o **link fixo** — funciona em qualquer lugar, com o PC desligado.
   - O botão **🔗 Compartilhar** no app passa a gerar links públicos desse domínio.

## 📝 Observações
- **Plano free:** o app "dorme" após ~15 min sem uso (1º acesso depois demora ~30s) e os
  rascunhos resetam a cada novo deploy. Para dados permanentes, troque `plan: free` por
  `plan: starter` no `render.yaml` e adicione um disco (ver `DEPLOY.md`).
- **Atualizar o app depois:** qualquer mudança no código, é só:
  ```bash
  git add -A && git commit -m "ajustes" && git push
  ```
  O Render reimplanta sozinho.

## 💻 Rodar local enquanto isso
- Duplo clique em `start.bat` (ou `node server.js`) → http://localhost:3001
