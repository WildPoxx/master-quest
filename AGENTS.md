# MasterQuest - instrucoes Codex para o repositorio do modulo

Este repositorio e a raiz de Git, testes e build do modulo `master-quest`.

Antes de editar codigo, leia o `AGENTS.md` da raiz ampla do projeto:

```text
..\..\AGENTS.md
```

Arquivos canonicos que ficam fora deste repositorio, mas governam o trabalho:

```text
..\..\09_SPECS\SPEC-00 - Indice e Regras de Uso.md
..\..\09_SPECS\SPEC-04 - Registro de Decisoes.md
..\..\12_DataBase - Backlog\Estado Integrado do Projeto.md
..\..\12_DataBase - Backlog\00_Indice.md
```

Para tarefas que toquem schema, merge, importacao, flags, Journal, sessoes ou campos de
quest, leia tambem:

```text
..\..\09_SPECS\SPEC-01 - Modelo de Dados da Quest.md
```

Para vocabulario novo ou renomeacao de conceitos, leia:

```text
..\..\09_SPECS\SPEC-03 - Glossario e Vocabulario.md
```

Comandos de validacao:

```powershell
npm run test:ci
git status --short --branch
```

Use branch com prefixo `codex` quando criar branch. Nunca commite segredo, `.env`, chave
privada, PDF comercial, backup bruto de servidor ou material privado.
