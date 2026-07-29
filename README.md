# MasterQuest

Módulo nativo de operações de quest para **Foundry VTT v14**: criação, organização e
condução de aventuras pelo Mestre — objetivos com revelação controlada, recompensas,
subquests, importação de aventuras com prévia e continuidade de campanha.

**English:** MasterQuest is a native quest-operations module for Foundry VTT v14 —
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
https://github.com/WildPoxx/master-quest/releases/latest/download/module.json
```

A partir daí o próprio Foundry oferece cada atualização — sem baixar ZIP na mão.

Requisitos: **Foundry VTT v14** (verificado na build 14.365). Nenhuma dependência de
sistema ou de outro módulo: o perfil SWADE ativa sozinho quando o sistema é SWADE, e
o suporte ao Forien's Quest Log é apenas leitura de snapshots para importar legado.

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

O contrato de compatibilidade com o v14 é travado por
`tests/foundry-v14-compat.test.js`, verificado contra o core real 14.365.
Versionamento `0.MINOR.0` pré-1.0; cada release publica o ZIP instalável e o
manifest na aba [Releases](https://github.com/WildPoxx/master-quest/releases).

## Licença

Código sob licença [MIT](LICENSE). Fonte Cinzel (SIL OFL 1.1) embarcada em
`styles/fonts/`; Signika é distribuída pelo próprio Foundry.

— WildPoxx
