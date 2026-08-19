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
