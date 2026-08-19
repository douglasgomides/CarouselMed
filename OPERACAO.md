# CarouselMed — como operar

Guia curto para quem cuida do app no dia a dia. Não precisa saber programar.

## Onde as coisas vivem

| O quê | Onde |
|---|---|
| Código | `github.com/douglasgomides/CarouselMed` |
| Hospedagem | Vercel, projeto `carouselmed` (conta Douglas) |
| Galeria, designs e templates | Supabase, projeto **Carrossel - MED**, bucket `carouselmed` |
| Chaves e senhas | Vercel → projeto → Environments → Production |

---

## Adicionar um template novo

**Não mexe em código.** Dentro do app:

1. Na coluna de estilos, clique em **+ Novo template de uma referência**
2. Escolha uma imagem que tenha o visual desejado
3. Dê um nome

O Claude lê o estilo da imagem e salva no servidor. **O template aparece
para o time inteiro na hora**, em qualquer navegador.

Para excluir, clique no ✕ no card do template. Isso apaga para todos.

---

## Adicionar ou remover uma pessoa

Na Vercel → projeto `carouselmed` → **Environments → Production** →
variável **`PANEL_USERS`**.

O formato é uma lista separada por vírgula:

```
fulano:senha-do-fulano,ciclana:senha-dela,equipe:senha-do-time
```

- **Adicionar**: acrescente `,nome:senha` no fim
- **Remover**: apague o trecho daquela pessoa. Ela perde o acesso na hora do
  próximo deploy, mesmo que já estivesse logada
- **Trocar senha**: mude só a senha daquela pessoa

Depois **sempre republique** (veja abaixo). Variável só passa a valer em
implantação nova.

---

## Publicar

**Todo `git push` na branch `main` publica sozinho.** Não precisa fazer nada.

Para republicar sem alterar código (por exemplo depois de mexer numa
variável): Vercel → **Deployments** → nos três pontinhos do deploy mais
recente → **Redeploy**.

---

## Quando o app mostra "CarouselMed trancado"

Não é falha, é proteção: o app se fecha quando não encontra credenciais, em
vez de ficar aberto para qualquer um.

Causas, nesta ordem:

1. A variável `PANEL_USERS` não existe, ou está escrita errado
2. Ela existe mas está marcada só em *Preview* ou *Development*, não em
   *Production*
3. Ela foi criada mas **ninguém republicou** desde então

---

## Contas e chaves

- `SESSION_SECRET` assina o cookie de login. Se você trocá-la, todo mundo é
  deslogado e precisa entrar de novo. Não é problema, só incômodo.
- `SUPABASE_SERVICE_ROLE_KEY` é a chave mestra do banco. Nunca coloque em
  código, nunca mande por WhatsApp, nunca cole em chat. Só na Vercel.
- Se alguma chave vazar: gere outra no Supabase, atualize a variável na
  Vercel, republique. A antiga morre sozinha.

---

## Adicionar template pelo Claude Code (ou por API)

O botão no app resolve o caso comum. Este caminho serve para **ajuste fino**:
controlar tamanho de fonte, cor exata, margens, ou criar a variante de capa.

### 1. Entrar e guardar a sessão

```bash
curl -s -c /tmp/cm.txt -X POST https://carouselmed.vercel.app/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"SEU_USUARIO","password":"SUA_SENHA"}'
```

### 2. Opção A — a partir de uma imagem de referência

```bash
curl -s -b /tmp/cm.txt -X POST https://carouselmed.vercel.app/api/analyze-template \
  -H 'Content-Type: application/json' \
  -d "{\"imageBase64\":\"$(base64 -i referencia.png)\",\"mimeType\":\"image/png\"}"
```

Devolve `{"fmt": {...}}`. Ajuste o que quiser e siga para o passo 3.

### 2. Opção B — escrever o `fmt` à mão

### 3. Salvar (fica disponível para o time inteiro)

```bash
curl -s -b /tmp/cm.txt -X POST https://carouselmed.vercel.app/api/templates \
  -H 'Content-Type: application/json' \
  -d '{"id":"meu_template","name":"Meu Template","fmt":{ ... },"previewGradient":"#f5f0eb"}'
```

Listar: `GET /api/templates` · Excluir: `DELETE /api/templates/:id`
Mandar o mesmo `id` de novo **sobrescreve** o template.

### Campos do `fmt`

| Campo | O que é |
|---|---|
| `bgType` | `image` \| `solid` \| `gradient` \| `split` |
| `bgColor` | hex do fundo sólido, ou da faixa inferior no `split`. `null` em image/gradient |
| `bgGradient` | CSS do degradê, ex: `linear-gradient(135deg,#0f2027,#2c5364)` |
| `bgSplitRatio` | 0.0–1.0: quanto da altura a foto ocupa no `split` (ex: 0.45) |
| `titleSize` | px do título, base 1080px de largura (52–90) |
| `subSize` | px do corpo (30–55) |
| `titleColor` / `subColor` | hex do texto principal e do secundário |
| `box` / `boxOp` | cor da caixa atrás do texto e opacidade: `0` sem caixa, `50–100` com |
| `shadow` | `true` se o texto tem sombra ou contorno |
| `align` | `left` \| `center` \| `right` |
| `justify` | `flex-start` topo · `center` meio · `flex-end` base |
| `gap` | px entre blocos de texto (12–40) |
| `font` | ex: `"Inter, sans-serif"`, `"Montserrat, sans-serif"`, `"Georgia, serif"` |
| `padX` / `padTop` / `padBottom` | margens em px, escala 1080×1350 |

Campos ausentes herdam o template `medico`. No `split`, o `padTop` é
corrigido sozinho para o texto não subir por cima da foto.

Para uma capa diferente do miolo, mande também `fmtCapa` com os mesmos campos.

### Exemplo pronto

```json
{
  "id": "clinico_claro",
  "name": "Clínico Claro",
  "previewGradient": "#f5f0eb",
  "fmt": {
    "bgType": "solid", "bgColor": "#f5f0eb",
    "titleSize": 76, "subSize": 44,
    "titleColor": "#12212e", "subColor": "#3d4c58",
    "box": "#ffffff", "boxOp": 0, "shadow": false,
    "align": "left", "justify": "center", "gap": 22,
    "font": "\"Montserrat\",\"Inter\",sans-serif",
    "padX": 72, "padTop": 120, "padBottom": 120
  }
}
```
