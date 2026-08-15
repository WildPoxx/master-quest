# MasterQuest

Linha beta de compatibilidade do módulo nativo de operações de quest para **Foundry VTT v13.351**: criação, organização e
condução de aventuras pelo Mestre — objetivos com revelação controlada, recompensas,
subquests, importação de aventuras com prévia e continuidade de campanha.

**English:** This is the Foundry VTT v13.351 beta compatibility line of MasterQuest —
GM-side authoring, quest log, controlled reveal, adventure import with preview, and
campaign continuity. It is system-agnostic with an optional SWADE profile. UI and
notes are currently in Brazilian Portuguese; an English localization is planned.

---

> ## ⚠️ Módulo em desenvolvimento
>
> O MasterQuest está em desenvolvimento ativo, pré-1.0. Versões novas saem com
> frequência, coisas mudam de lugar e **pode haver bugs** — use em mundo de teste ou
> faça backup antes de levar para campanha real.
>
> **Comentários, sugestões e relatos de bug são muito bem-vindos.** O canal é a aba
> [**Issues**](https://github.com/WildPoxx/master-quest/issues): basta uma conta
> GitHub — sem e-mail, sem formalidade, em português ou inglês. Para ideias e
> dúvidas de uso, a aba
> [**Discussions**](https://github.com/WildPoxx/master-quest/discussions) também
> está aberta.

## Instalação

No Foundry, em **Add-on Modules → Install Module**, cole no campo **Manifest URL**:

```text
https://raw.githubusercontent.com/WildPoxx/master-quest/codex/compat-v13/module.json
```

A partir daí o próprio Foundry oferece cada atualização — sem baixar ZIP na mão.

Requisitos: **Foundry VTT 13.351**. Esta é uma linha beta separada da V14: use-a em
mundo de teste e mantenha backup antes de atualizar uma campanha. A primeira matriz de
validação é **Cosmere 3.0.1** e **SWADE 5.2.6**; o núcleo continua sem dependência de
sistema ou de outro módulo. O perfil SWADE ativa sozinho, e o suporte ao Forien's Quest
Log é apenas leitura de snapshots para importar legado.

Não instale este manifesto no Foundry V14. Para a linha V14, use o manifesto `latest`
documentado na branch `main`.

## O que o módulo faz hoje

- **Quest Log** com status visíveis aos jogadores (Disponíveis, Em Andamento,
  Concluídas) e visão completa do Mestre (incluindo Fracassadas e Inativas);
- **Detalhes de quest**: objetivos com visibilidade individual (objetivo novo nasce
  oculto; revelar é ato deliberado do Mestre), recompensas, subquests, imagem e
  notas do GM;
- **Hub** central e **importação de aventuras** a partir de texto estruturado,
  Journals e snapshots legados do FQL — sempre com prévia antes de gravar;
- **Console de criação** para rascunhar quests a partir de um briefing parcial, com
  prévias separadas (o que o jogador veria × o que o Mestre vê);
- Armazenamento em Journal nativo do Foundry — nenhum banco paralelo;
- **Skin pergaminho** sobre um sistema de design tokens; skins temáticas para
  outros gêneros de campanha já estão previstas na arquitetura.

## Modelo de segurança

As camadas de criação, importação e prévia são **somente leitura** até o Mestre
clicar em `Salvar em Journal` (ou chamar `saveDraftToJournal`). O módulo não cria
nem altera `JournalEntry` sem ação explícita do GM, não grava payloads FQL, não cria
actors/items/combats/settings e não mexe no mundo ao vivo fora do armazenamento
próprio de rascunhos.

## API pública

```js
const api = game.modules.get("master-quest").api;

api.masterQuest.detectSystemProfile();
api.masterQuest.createDraft(seed, options);
api.masterQuest.assessDraft(draft);
api.masterQuest.generateAuthoringQuestions(seedOrDraft, options);
api.masterQuest.generatePreview(draft, { audience: "gm" });
api.masterQuest.suggestElements(seedOrDraft, { target: "complete" });
await api.masterQuest.saveDraftToJournal(draft);
api.masterQuest.generateFoundryExportPreview(draft, options);
api.masterQuest.generateImportPreview(source, options);
api.masterQuest.startAuthoringWizard(seedOrDraft, options);
api.masterQuest.continueAuthoringWizard(sessionOrDraft, answers, options);
```

Operações legadas de FQL ficam agrupadas em `api.legacyFql`.

## Desenvolvimento

```bash
npm run test:ci    # subconjunto confiável; deve ficar 100% verde
node --test tests/*.test.js
```

O contrato de compatibilidade desta linha é travado por
`tests/foundry-v13-compat.test.js`, baseado no core real 13.351 e executado em Node
20.18.0 no CI. A beta usa versões como `0.30.3-v13.0`; cada release publica
`master-quest-v13.zip` e o manifest na aba
[Releases](https://github.com/WildPoxx/master-quest/releases).

## Licença

Código sob licença [MIT](LICENSE). Fonte Cinzel (SIL OFL 1.1) embarcada em
`styles/fonts/`; Signika é distribuída pelo próprio Foundry.

— WildPoxx
