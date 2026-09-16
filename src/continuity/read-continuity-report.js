function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[—–]/g, "-")
    .trim()
    .toLowerCase();
}

function stripMarkdownDecorators(value) {
  return String(value ?? "")
    .replace(/^\*+\s*/, "")
    .replace(/\s*\*+$/, "")
    .trim();
}

function parseCount(line, label) {
  const normalized = normalizeText(line);
  const target = normalizeText(label);
  const match = normalized.match(new RegExp(`^[-*]?\\s*\\*\\*${escapeRegExp(target)}:\\*\\*\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionKey(title) {
  return normalizeText(title).replace(/^\d+\.\s*/, "");
}

function extractSections(lines) {
  const sections = new Map();
  let currentTitle = null;
  let buffer = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^##\s+\d+\.\s+/.test(line.trim())) {
      if (currentTitle) sections.set(sectionKey(currentTitle), buffer);
      currentTitle = line.replace(/^##\s+/, "");
      buffer = [];
      continue;
    }
    if (currentTitle) buffer.push(line);
  }

  if (currentTitle) sections.set(sectionKey(currentTitle), buffer);
  return sections;
}

/**
 * O relatorio do FQL diz "aqui nao ha nada" com uma FRASE, e a frase vem como item de lista.
 *
 * Ate a 1.2.0 havia uma guarda para isso, mas ela exigia que a linha NAO fosse bullet
 * (`!line.startsWith("- ")`) — e no corpus real do Lost Frontier os marcadores de vazio sao
 * justamente bullets: `- Nenhuma ponta solta selecionada.`, `- _Nenhum alerta registrado
 * neste fechamento._`. Resultado: rodando contra os dez relatorios reais, o bloco de pontas
 * soltas vinha inflado com dezenas de linhas que dizem que nao ha pontas soltas.
 *
 * Isso e pior do que ruido: e AUSENCIA com aparencia de CONTEUDO, no mecanismo que existe
 * exatamente para o Mestre confiar no que le. Contraria a DEC-066 pelo lado que ela nao
 * previu — nao e adivinhacao, e transcricao de um vazio.
 *
 * RISCO DECLARADO: uma ponta solta legitima que comece com "Nenhuma..." seria descartada
 * (por exemplo, "Nenhuma testemunha apareceu — insistir na Sessao 07"). O corpus real nao
 * tem nenhum caso assim, e o custo do erro inverso — inflar o bloco — e maior. Se aparecer,
 * a correcao e exigir que a frase TERMINE em ponto sem oracao subordinada, nao afrouxar isto.
 *
 * @param {string} text One list item, already without the bullet marker.
 * @returns {boolean} True when the line states emptiness instead of content.
 */
function isEmptinessMarker(text) {
  const bare = String(text ?? "").replace(/^_+|_+$/g, "").trim();
  return /^nenhum[ao]?\b/.test(normalizeText(bare));
}

function parseBulletSection(lines, { defaultGroup = null } = {}) {
  const items = [];
  let currentGroup = defaultGroup;
  let currentDate = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = normalizeText(line);

    if (!line) continue;

    if (line.startsWith("### ")) {
      currentGroup = line.slice(4).trim();
      currentDate = null;
      continue;
    }

    if (normalized.startsWith("data:")) {
      currentDate = line.split(":").slice(1).join(":").trim();
      continue;
    }

    if (
      !line.startsWith("- ") &&
      !line.startsWith("_") &&
      !line.startsWith("**") &&
      !line.startsWith("|") &&
      !line.startsWith(">") &&
      !/^##\s+/.test(line)
    ) {
      currentGroup = line;
      currentDate = null;
      continue;
    }

    if (normalized.includes("nenhum") && !line.startsWith("- ")) continue;

    if (line.startsWith("- ")) {
      const text = line.slice(2).trim();
      // A guarda de vazio agora vale TAMBEM para bullets. Ver isEmptinessMarker.
      if (isEmptinessMarker(text)) continue;
      items.push({ group: currentGroup, date: currentDate, text });
    }
  }

  return items;
}

function extractInlineBulletList(lines, startLabel, endLabels = []) {
  const startKey = normalizeText(startLabel);
  const endKeys = endLabels.map((label) => normalizeText(label));
  const items = [];
  let collecting = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = normalizeText(line);

    if (!collecting) {
      if (normalized === startKey) collecting = true;
      continue;
    }

    if (endKeys.includes(normalized) || /^##\s+\d+\./.test(line)) break;
    if (line.startsWith("- ")) items.push(line.slice(2).trim());
  }

  return items;
}

function parseCloseoutEntries(lines) {
  const entries = [];
  let current = null;
  let mode = null;

  function pushCurrent() {
    if (!current) return;
    current.gmComment = current.gmComment.trim() || null;
    entries.push(current);
    current = null;
    mode = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = normalizeText(line);

    if (!line) {
      if (mode !== "gmComment") mode = null;
      continue;
    }

    if (line.startsWith("### ")) {
      pushCurrent();
      const heading = line.slice(4).trim();
      const match = heading.match(/^(.*?)(?:\s+[—-]\s+([A-Za-z]+))$/);
      current = {
        heading,
        title: match ? match[1].trim() : heading,
        scope: match ? normalizeText(match[2]) : "unknown",
        date: null,
        summary: null,
        consequence: null,
        gmComment: "",
        alerts: [],
        looseEnds: []
      };
      mode = null;
      continue;
    }

    if (!current) continue;

    if (normalized.startsWith("- data:")) {
      current.date = line.split(":").slice(1).join(":").trim();
      mode = null;
      continue;
    }

    if (normalized.startsWith("- resumo:")) {
      current.summary = line.split(":").slice(1).join(":").trim();
      mode = null;
      continue;
    }

    if (normalized.startsWith("- consequencia:")) {
      current.consequence = line.split(":").slice(1).join(":").trim();
      mode = null;
      continue;
    }

    if (normalized.startsWith("- comentario do mestre:")) {
      current.gmComment = line.split(":").slice(1).join(":").trim();
      mode = "gmComment";
      continue;
    }

    if (normalized === "**alertas deste fechamento:**") {
      mode = "alerts";
      continue;
    }

    if (normalized === "**pontas soltas deste fechamento:**") {
      mode = "looseEnds";
      continue;
    }

    if (mode === "gmComment") {
      if (
        line.startsWith("**") ||
        line.startsWith("### ") ||
        normalized.startsWith("- data:") ||
        normalized.startsWith("- resumo:") ||
        normalized.startsWith("- consequencia:")
      ) {
        mode = null;
      } else {
        current.gmComment = current.gmComment
          ? `${current.gmComment}\n${line}`
          : line;
        continue;
      }
    }

    if ((mode === "alerts" || mode === "looseEnds") && line.startsWith("- ")) {
      const text = line.slice(2).trim();
      if (isEmptinessMarker(text)) continue;
      const list = mode === "alerts" ? current.alerts : current.looseEnds;
      list.push(text);
    }
  }

  pushCurrent();
  return entries;
}

function inferReportScope(preSectionTwoLines, closeoutEntries, questTitle) {
  const normalizedQuestTitle = normalizeText(questTitle);

  const exactCloseout = closeoutEntries.find((entry) => normalizeText(entry.title) === normalizedQuestTitle);
  if (exactCloseout?.scope) return exactCloseout.scope;

  const preSectionTwoText = normalizeText(preSectionTwoLines.join("\n"));
  if (preSectionTwoText.includes("fechamento de modulo")) return "module";
  if (preSectionTwoText.includes("fechamento de sessao")) return "session";

  return "unknown";
}

export function readContinuityReportState(reportText, options = {}) {
  const text = String(reportText ?? "");
  const lines = text.split(/\r?\n/);
  const sections = extractSections(lines);

  const reportTitleMatch = text.match(/^#\s+Relat[^\n]*[—-]\s+(.+)$/m);
  const reportTitle = reportTitleMatch?.[1]?.trim() ?? null;

  const generatedAtMatch = text.match(/_Gerado em:\s*([^_]+)_/);
  const generatedAtLabel = generatedAtMatch?.[1]?.trim() ?? null;

  const reportAlerts = lines
    .filter((line) => line.trim().startsWith("> **ALERTA:**"))
    .map((line) => line.replace(/^>\s*\*\*ALERTA:\*\*\s*/i, "").trim());

  let questTitle = null;
  let reportedStatus = "unknown";
  let objectiveCounts = { completed: 0, failed: 0, pending: 0 };
  let rewardCounts = { obtained: 0, pending: 0 };

  for (const line of lines) {
    const normalized = normalizeText(line);

    if (!questTitle && normalized.startsWith("- **quest principal:**")) {
      questTitle = stripMarkdownDecorators(line.split(":").slice(1).join(":").trim());
      continue;
    }

    if (normalized.startsWith("- **status:**")) {
      reportedStatus = normalizeText(stripMarkdownDecorators(line.split(":").slice(1).join(":").trim())) || "unknown";
      continue;
    }

    const completed = parseCount(line, "objetivos concluidos");
    if (completed !== null) {
      objectiveCounts.completed = completed;
      continue;
    }

    const failed = parseCount(line, "objetivos falhos");
    if (failed !== null) {
      objectiveCounts.failed = failed;
      continue;
    }

    const pending = parseCount(line, "objetivos pendentes");
    if (pending !== null) {
      objectiveCounts.pending = pending;
      continue;
    }

    const obtained = parseCount(line, "rewards obtidas");
    if (obtained !== null) {
      rewardCounts.obtained = obtained;
      continue;
    }

    const rewardPending = parseCount(line, "rewards pendentes");
    if (rewardPending !== null) {
      rewardCounts.pending = rewardPending;
    }
  }

  const completedObjectives = parseBulletSection(
    sections.get("objetivos concluidos por subquest") ?? [],
    { defaultGroup: questTitle }
  );
  const failedObjectives = parseBulletSection(
    sections.get("objetivos falhos ou perdidos por subquest") ?? [],
    { defaultGroup: questTitle }
  );
  const pendingObjectives = parseBulletSection(
    sections.get("objetivos pendentes por subquest") ?? [],
    { defaultGroup: questTitle }
  );
  const obtainedRewards = parseBulletSection(sections.get("recompensas obtidas") ?? [])
    .map((entry) => entry.text);
  const closeoutEntries = parseCloseoutEntries(sections.get("closeouts registrados") ?? []);
  const looseEnds = parseBulletSection(sections.get("pontas soltas") ?? []);

  const preSectionTwoLines = [];
  for (const line of lines) {
    if (/^##\s+2\./.test(line.trim())) break;
    preSectionTwoLines.push(line);
  }

  const inlineObtainedRewards = extractInlineBulletList(
    preSectionTwoLines,
    "Recompensas Obtidas",
    ["Recompensas Falhas ou Perdidas"]
  );

  const sectionObtainedRewards = parseBulletSection(sections.get("recompensas obtidas") ?? [])
    .map((entry) => entry.text)
    .filter((entry) => !normalizeText(entry).startsWith("_nenhuma"))
    .filter((entry) => !normalizeText(entry).startsWith("nenhuma"));

  return {
    schemaVersion: 1,
    sourcePath: options.sourcePath ?? null,
    reportTitle,
    generatedAtLabel,
    questTitle,
    reportScope: inferReportScope(preSectionTwoLines, closeoutEntries, questTitle),
    reportedStatus,
    objectiveCounts,
    rewardCounts,
    reportAlerts,
    completedObjectives,
    failedObjectives,
    pendingObjectives,
    obtainedRewards: sectionObtainedRewards.length ? sectionObtainedRewards : inlineObtainedRewards,
    looseEnds,
    closeoutEntries
  };
}
