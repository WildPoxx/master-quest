/**
 * Build the Ecos da Torre quest blueprint.
 *
 * Source of truth: `10_Livro-Jogo/Quests/Ato I - Arquitetura FQL - Ecos da Torre.md`
 * in the Conan Legacy vault. Nothing here is invented: every description, task, clock
 * step, trigger and journal link is transposed from that document.
 *
 * The blueprint is a reviewable data contract. It is NOT applied to a world by running
 * this script — it only writes the JSON. Import goes through the preview/apply path in
 * `src/quest/quest-blueprint.js`.
 *
 * Run: node scripts/build-ecos-da-torre-blueprint.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "blueprints");
const OUT_FILE = join(OUT_DIR, "ecos-da-torre.quest-blueprint.json");

const p = (...paragraphs) => paragraphs.map((t) => `<p>${t}</p>`).join("\n");
const section = (heading, items) =>
  `<h3>${heading}</h3>\n<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const visible = (name) => ({ name, hidden: false });
const hidden = (name) => ({ name, hidden: true });

/** Clock steps become hidden objectives: the track is GM-side pressure, not a checklist. */
const clockSteps = (steps) => steps.map((label, index) => hidden(`${index}. ${label}`));

const MAIN = {
  designId: "MQ-ATO1-01",
  name: "Ecos da Torre",
  type: "main",
  status: "active",
  parent: null,
  priority: 100,
  description: p(
    "A Torre de Khar-Volun, há muito evitada por caçadores, comerciantes e soldados, voltou a chamar atenção. Um jovem hyrkaniano parece ter sido levado para a região, rumores falam de um comprador mascarado, e homens poderosos passaram a observar as mesmas estradas. Antes que a fronteira decida por vocês, resta descobrir quem está correndo para a Torre e por quê."
  ),
  gmnotes: [
    p(
      "Esta Main Quest deve ser ativada desde a chegada a Karavazyan. Ela não precisa revelar Kuth, o real destino de Khar-Volun, nem a natureza defensiva da Torre. A verdade inicial é suficiente: existe uma pessoa desaparecida, uma rota perigosa, um comprador associado à Torre e facções com interesses concorrentes."
    ),
    section("Premissa operacional", [
      "Os personagens chegam a Karavazyan sob pressão.",
      "Descobrem que a Torre voltou a mover interesses.",
      "Escolhem como sair da cidade: por dever, por patrono, por lucro, por vingança ou por necessidade.",
      "Atravessam a região de Golamra enquanto facções, rivais e sonhos os alcançam.",
      "Chegam à Torre sem que isso resolva o problema, apenas mudando sua natureza."
    ]),
    section("Tom", [
      "Karavazyan deve parecer uma cidade viva antes de parecer uma interface de quest.",
      "A pergunta central do Ato I não é &quot;onde fica a Torre?&quot;, mas &quot;quem vocês se tornam ao aceitar chegar lá?&quot;.",
      "Thal-Remmon, Venarium e os Warbarons começam como pressão histórica e política, não como exposição frontal.",
      "Kuth aparece como erro, sonho, coincidência e medo antes de aparecer como entidade ou verdade."
    ]),
    section("Fontes", [
      "Capítulo 1 — O Ano da Coroa Quebrada - Doc de Trabalho.md",
      "CENAS/ATO I — CENA 1C - A Estrada do Norte (Glacestus, Sabotei e Duma).md",
      "CENAS/ATO I — CENA 2 - O MERCADO DAS CORRENTES.md",
      "CENAS/ATO I — CENA 3 - A Quinta Roda — O Teste do Fogo.md",
      "CENAS/ATO I — CENA 4 - v1.md",
      "CENAS/ATO I — CENA 4 - v2.md"
    ])
  ].join("\n"),
  objectives: [
    visible("Chegar a Karavazyan e reunir informações confiáveis."),
    visible("Descobrir quem comprou ou transportou o jovem hyrkaniano."),
    visible("Identificar uma rota até a região de Golamra."),
    visible("Definir se o grupo parte oficialmente, financiado por patrono ou por conta própria."),
    visible("Alcançar a Torre de Khar-Volun."),
    hidden("Registrar se a carta de Glacestus permanece intacta, foi destruída, confiscada ou perdida."),
    hidden("Registrar qual facção percebeu primeiro o valor do grupo."),
    hidden("Registrar se Ali Al'Farrad, Molochai ou outro patrono obteve vantagem."),
    hidden("Registrar o avanço do relógio dos rivais."),
    hidden("Registrar o avanço do relógio onírico de Kuth.")
  ],
  activationTriggers: [],
  journalLinks: []
};

const SUBQUESTS = [
  {
    designId: "SQ-ATO1-01",
    name: "Chegada a Karavazyan",
    status: "active",
    priority: 90,
    description: p(
      "Karavazyan se move entre rodas, tendas, correntes, vozes e poeira. Quem procura alguém ali precisa primeiro descobrir quem vende lembranças, quem vende silêncio e quem vende gente."
    ),
    dramaticFunction:
      "Transformar a chegada à cidade em ponto de convergência: os PCs chegam com urgências diferentes, mas a cidade imediatamente mostra que tudo passa por mercadoria, reputação, medo e informação.",
    swade:
      "Trait Rolls para leitura social, Notice/Streetwise/Persuasion; Support para PCs ajudando investigações; Tests sociais se guardas, mercadores ou provocadores pressionarem o grupo.",
    objectives: [
      visible("Entrar em Karavazyan sem perder o controle da situação."),
      visible("Descobrir onde circulam mercadores de escravos, rastreadores e informantes."),
      visible("Identificar o nome de Narzim ibn Haroud como pista relevante."),
      visible("Chegar ao Mercado das Correntes."),
      hidden("Marcar se os personagens chamaram atenção da Guarda Silenciosa."),
      hidden("Marcar se algum NPC de Karavazyan se interessou pelo grupo."),
      hidden("Marcar se Sabotei manteve ou perdeu controle emocional."),
      hidden("Marcar se Glacestus revelou, protegeu ou comprometeu sua carta.")
    ],
    activationTriggers: [],
    journalLinks: [
      "Karavazyan - A Cidade sobre Rodas",
      "Ambientação Geral de Karavazyan",
      "Nomes Que Circulam [NPCs]",
      "Dhorim Vance",
      "Narzim ibn Haroud"
    ]
  },
  {
    designId: "SQ-ATO1-02",
    name: "O Mercado das Correntes",
    status: "inactive",
    priority: 80,
    description: p(
      "No Terceiro Círculo, nomes mudam de dono tão rápido quanto correntes. Narzim pode saber para onde o jovem hyrkaniano foi levado, mas nada em Karavazyan é dito sem preço, testemunha ou ameaça."
    ),
    dramaticFunction:
      "Converter o rumor em pista concreta. O Mercado das Correntes deve apresentar o horror cotidiano de Karavazyan sem ainda entregar o horror cósmico por inteiro.",
    completion:
      "Concluir quando o grupo souber que o comprador está associado à Torre velha, à região de Golamra ou a um intermediário suficientemente preciso para mover a ação.",
    swade:
      "Social Conflict ou Trait Rolls encadeados para negociar com Narzim; Fear leve ou Test de autocontrole se Ashiq profetizar demais; Quick Encounter se a situação virar tumulto.",
    objectives: [
      visible("Encontrar Narzim ibn Haroud."),
      visible("Descobrir quem comprou o jovem hyrkaniano."),
      visible("Obter a direção geral da Torre ou da região de Golamra."),
      visible("Lidar com Ashiq, Valerius ou outro incidente público sem perder a pista."),
      hidden("Registrar se Narzim informa Ali Al'Farrad sobre o grupo."),
      hidden("Registrar o estado da carta de Glacestus."),
      hidden("Registrar se Valerius se torna obstáculo, aliado tático ou inimigo recorrente."),
      hidden("Registrar se Ashiq planta uma pista onírica ou apenas medo.")
    ],
    activationTriggers: [
      { label: "Narzim entrega a pista em Chegada a Karavazyan.", grantsStatus: "active" }
    ],
    journalLinks: [
      "O Mercado das Correntes",
      "Narzim ibn Haroud",
      "Ali Al'Farrad",
      "Ashiq",
      "Valerius",
      "Guarda Silenciosa"
    ]
  },
  {
    designId: "SQ-ATO1-03",
    name: "O Teste do Fogo",
    status: "inactive",
    priority: 70,
    description: p(
      "Na Quinta Roda, reputação vale tanto quanto aço. Os Abutres de Golamra têm mapa, equipamento e arrogância. Outros olhos observam quem cede, quem compra, quem ameaça e quem sangra."
    ),
    dramaticFunction:
      "Forçar o grupo a se tornar público. Depois da Quinta Roda, os PCs não são apenas viajantes: são concorrentes, instrumento de patrono, risco político ou presa útil.",
    exitStates: [
      "<strong>Partida oficial</strong>: o grupo sai com alguma legitimidade e maior risco político.",
      "<strong>Partida financiada</strong>: o grupo sai melhor equipado, mas com dívida ou expectativa de retorno.",
      "<strong>Partida independente</strong>: o grupo mantém liberdade, mas perde proteção, mapas ou suprimentos."
    ],
    swade:
      "Tests, Social Conflict, Quick Encounter e Chase. Combate só deve ocorrer se houver objetivo dramático além de ferir inimigos: preservar mapa, impedir fuga, proteger reputação, salvar alguém ou evitar incêndio.",
    objectives: [
      visible("Enfrentar ou neutralizar os Abutres de Golamra."),
      visible("Impedir que Soren fuja com informação decisiva, se isso se tornar relevante."),
      visible("Descobrir uma rota melhor até Golamra."),
      visible("Escolher como o grupo parte: missão formal, financiamento privado ou independência."),
      visible("Preparar suprimentos para a jornada."),
      hidden("Marcar se Ali Al'Farrad manipula a cena com sucesso."),
      hidden("Marcar se Molochai reconhece utilidade política no grupo."),
      hidden("Marcar se os Abutres sobrevivem, fogem, se vingam ou chegam primeiro."),
      hidden("Marcar se a reputação pública do grupo sobe ou se torna perigosa.")
    ],
    activationTriggers: [{ label: "A pista da Torre fica clara.", grantsStatus: "active" }],
    journalLinks: ["A Quinta Roda", "Abutres de Golamra", "Ali Al'Farrad", "Molochai", "Soren"]
  },
  {
    designId: "SQ-ATO1-04",
    name: "Rumo a Golamra",
    status: "inactive",
    priority: 60,
    description: p(
      "A estrada para Golamra não é uma estrada. É uma sucessão de mato fechado, pedra antiga, trilhas apagadas e noites que parecem lembrar coisas que ninguém viveu."
    ),
    dramaticFunction:
      "Tirar a segurança relativa da cidade e transformar decisões anteriores em custo concreto: cansaço, rota, rival, sonhos, sinais errados e facções chegando pelas bordas.",
    swade:
      "Travel como estrutura principal; Hazards para terreno e clima; Interludes para memória, medo e vínculos; Dramatic Tasks para travessias críticas; Fear para sonhos e intrusões de Kuth; Chases para perseguição ou fuga de batedores.",
    objectives: [
      visible("Definir formação, ritmo de marcha e responsabilidades."),
      visible("Sobreviver ao primeiro dia de viagem."),
      visible("Enfrentar ou interpretar a primeira noite de sonhos."),
      visible("Encontrar sinais da rota para Golamra."),
      visible("Chegar à visão inicial da Torre."),
      hidden("Avançar ou reduzir o relógio dos rivais."),
      hidden("Avançar ou reduzir o relógio onírico de Kuth."),
      hidden("Registrar perda de suprimentos, fadiga, ferimentos ou equipamento."),
      hidden("Registrar pistas abertas pelo amuleto de Xanthes."),
      hidden("Registrar se alguma facção recebe notícia da direção seguida.")
    ],
    activationTriggers: [{ label: "O grupo escolhe patrono e rota.", grantsStatus: "active" }],
    journalLinks: ["Golamra", "Protocolo Onírico — Sonhos de Kethryll", "Khar-Volun", "Xanthes", "Kuth"]
  },
  {
    designId: "SQ-ATO1-05",
    name: "A Torre Sem Guardião",
    status: "inactive",
    priority: 50,
    description: p(
      "A Torre não parece abandonada. Parece fechada contra algo. A pergunta é se Khar-Volun tentou impedir que alguém entrasse ou que algo saísse."
    ),
    dramaticFunction:
      "Entrada futura. Deve permanecer inativa até os PCs alcançarem a Torre. Quando ativada, encerra a lógica da investigação urbana/viagem e inicia a lógica de exploração, revelação e contenção.",
    objectives: [
      visible("Encontrar uma entrada segura ou possível."),
      visible("Interpretar os primeiros sinais deixados por Khar-Volun."),
      visible("Descobrir se o jovem hyrkaniano ainda pode ser salvo."),
      visible("Sobreviver ao primeiro contato com a defesa da Torre."),
      hidden("Registrar a primeira manifestação direta de Kuth."),
      hidden("Registrar que tipo de verdade sobre Khar-Volun foi descoberta."),
      hidden("Registrar se a Torre reconhece amuleto, sangue, sonho ou magia.")
    ],
    activationTriggers: [
      { label: "A Torre aparece; Rumo a Golamra é concluída.", grantsStatus: "active" }
    ],
    journalLinks: ["Khar-Volun", "Kuth"]
  }
];

const CLOCKS = [
  {
    designId: "CLOCK-ATO1-01",
    name: "Quem Chega Primeiro",
    intro:
      "Relógio de rivalidade para Abutres, agentes de Al'Farrad, caçadores independentes, Shadow Lions ou outros grupos que disputem a Torre.",
    steps: [
      "Ninguém relevante está à frente.",
      "Rivais têm uma pista parcial.",
      "Rivais têm rota ou guia.",
      "Rivais partem antes ou alcançam o grupo.",
      "Rivais chegam primeiro a uma zona externa.",
      "Rivais ativam perigo, armadilha ou facção.",
      "Rivais alteram a Torre antes dos PCs."
    ],
    extra: null
  },
  {
    designId: "CLOCK-ATO1-02",
    name: "O Sonho de Kuth",
    intro:
      "Relógio de pressão sobrenatural. Não representa apenas corrupção; representa proximidade, atenção e erro crescente no mundo.",
    steps: [
      "Pesadelos comuns.",
      "Símbolos recorrentes.",
      "Sonho compartilhado ou sensação física ao acordar.",
      "Uma pista verdadeira aparece misturada a medo.",
      "Um PC carrega marca, compulsão ou eco.",
      "Kuth responde a uma pergunta que ninguém fez.",
      "A Torre reage antes da chegada."
    ],
    extra: null
  },
  {
    designId: "CLOCK-ATO1-03",
    name: "Olhos Sobre o Grupo",
    intro:
      "Relógio político e social. Deve ser alimentado quando os PCs fazem cenas públicas, usam nomes importantes, vencem conflitos visíveis ou carregam artefatos.",
    steps: [],
    extra: section("Facções que podem receber avanço", [
      "Sommarel.",
      "Irmandade da Aranha.",
      "Shadow Lions.",
      "Voidwatchers.",
      "Guarda Silenciosa.",
      "Rede de Ali Al'Farrad.",
      "Homens de Molochai."
    ])
  }
];

const SIDE_QUESTS = [
  ["SIDE-KARA-01", "A Teia Sob a Areia", "Ali Al'Farrad, Sommarel, artefatos ou arquivos", "Explora espionagem, dívida, chantagem e interesse de facções na Torre."],
  ["SIDE-KARA-02", "O Filho da Filha", "Sahysia, herança, sangue ou legitimidade", "Liga família, sucessão e segredos íntimos à política de Karavazyan."],
  ["SIDE-KARA-03", "Sangue na Areia", "Valerius, Guarda Silenciosa, violência pública", "Converte conflito social em investigação de autoridade e vingança."],
  ["SIDE-KARA-04", "Perfume e Vingança", "Lian Mei, Sommarel, favores íntimos", "Permite intriga sem combate: venenos sociais, informação e sedução política."],
  ["SIDE-KARA-05", "O Livro Que Nunca Existiu", "Mael Theron, Corvin Dhal, Voidwatchers", "Liga sonhos, escrita, presságios e registros impossíveis."],
  ["SIDE-KARA-06", "O Preço de Uma Rota", "Dhorim Vance, caravanas, Quinta Roda", "Transforma logística em conflito: mapas, rodas, guias, escolta e contrabando."],
  ["SIDE-IMP-01", "O Leão Sem Coroa", "Notícias de Venarium ou Shadow Lions", "Mostra Thal-Remmon como poder de fato sem legitimidade formal."],
  ["SIDE-IMP-02", "A Chave de Velitrium", "Rotas ao norte, Verden, ataques pictos", "Faz Velitrium virar peça estratégica entre fronteira, Warbarons e Shadow Lions."],
  ["SIDE-IMP-03", "A Carta e o Senado", "Carta de Glacestus intacta ou confiscada", "Conecta a missão à crise sucessória de Aquilonia."],
  ["SIDE-IMP-04", "Rotas Protegidas", "Escoltas Shadow Lions em caravanas", "Revela a expansão indireta de Thal-Remmon por meio de segurança, dívida e presença."],
  ["SIDE-IMP-05", "O Nome de Venarium", "veteranos, ruínas, símbolos ou trauma", "Usa a cidade-fortaleza como cicatriz política e mítica da fronteira."],
  ["SIDE-OCC-01", "Sonhos de Kethryll", "Falha ou raise no protocolo onírico", "Dá forma investigável aos sonhos sem revelar Kuth cedo demais."],
  ["SIDE-OCC-02", "Sangue do Leão Vermelho", "Cadernos de Khar-Volun ou Asclipas", "Introduz o soro da imortalidade como obsessão perigosa."],
  ["SIDE-OCC-03", "O Amuleto de Xanthes", "Reação do amuleto em trilha, selo ou sonho", "Transforma objeto pessoal em chave narrativa e mecânica."],
  ["SIDE-OCC-04", "A Voz Que Consola", "Mael Theron ou Voidwatchers", "Permite investigar sonhos como religião, cuidado, manipulação ou erro."],
  ["SIDE-OCC-05", "O Homem Que Fechou a Porta", "sinais defensivos da Torre", "Reenquadra Khar-Volun como alguém que talvez tenha tentado conter o horror."]
];

function buildSubquest(entry) {
  const gm = [];
  if (entry.dramaticFunction) gm.push(`<h3>Função dramática</h3>\n<p>${entry.dramaticFunction}</p>`);
  if (entry.completion) gm.push(`<h3>Gatilhos de conclusão</h3>\n<p>${entry.completion}</p>`);
  if (entry.exitStates) gm.push(section("Estados de saída", entry.exitStates));
  if (entry.swade) gm.push(`<h3>Ferramentas SWADE</h3>\n<p>${entry.swade}</p>`);

  return {
    designId: entry.designId,
    name: entry.name,
    type: "subquest",
    status: entry.status,
    parent: MAIN.designId,
    priority: entry.priority,
    description: entry.description,
    gmnotes: gm.join("\n"),
    objectives: entry.objectives,
    activationTriggers: entry.activationTriggers,
    journalLinks: entry.journalLinks
  };
}

function buildClock(entry) {
  const gm = [`<p>${entry.intro}</p>`];
  if (entry.extra) gm.push(entry.extra);
  gm.push(
    "<p><em>Relógio de GM: invisível aos jogadores, salvo se o efeito dramático for mostrar pressão sem explicar sua causa.</em></p>"
  );

  return {
    designId: entry.designId,
    name: entry.name,
    type: "clock",
    status: "inactive",
    parent: MAIN.designId,
    priority: 40,
    // A clock has no player-facing description on purpose.
    description: "",
    gmnotes: gm.join("\n"),
    objectives: clockSteps(entry.steps),
    activationTriggers: [],
    journalLinks: []
  };
}

function buildSide([designId, name, trigger, role]) {
  return {
    designId,
    name,
    type: "side",
    status: "inactive",
    parent: MAIN.designId,
    priority: 20,
    // Deliberately empty: the source document defines these by trigger and campaign role
    // only. Authoring the player-facing text is a later, explicit act.
    description: "",
    gmnotes: [
      `<h3>Papel na campanha</h3>\n<p>${role}</p>`,
      `<h3>Gatilho</h3>\n<p>${trigger}</p>`,
      "<p><em>Esboço: texto para jogadores e objetivos ainda não escritos no documento-fonte.</em></p>"
    ].join("\n"),
    objectives: [],
    activationTriggers: [{ label: trigger, grantsStatus: "available" }],
    journalLinks: []
  };
}

const quests = [
  MAIN,
  ...SUBQUESTS.map(buildSubquest),
  ...CLOCKS.map(buildClock),
  ...SIDE_QUESTS.map(buildSide)
];

const blueprint = {
  schemaVersion: 1,
  blueprintId: "ecos-da-torre",
  title: "Ato I - Ecos da Torre",
  campaign: "Conan Legacy",
  system: "swade",
  folderName: "MasterQuest - Ato I",
  source: {
    document: "10_Livro-Jogo/Quests/Ato I - Arquitetura FQL - Ecos da Torre.md",
    vault: "conan-legacy",
    note: "Transposição fiel. Nenhum conteúdo narrativo foi criado fora do documento-fonte."
  },
  activationSequence: [
    "Criar MQ-ATO1-01 — Ecos da Torre como ativa.",
    "Criar SQ-ATO1-01 — Chegada a Karavazyan como ativa.",
    "Criar as demais subquests como inativas.",
    "Criar side quests como inativas, exceto alguma já acionada em mesa.",
    "Criar clocks como inativos ou GM-only.",
    "Quando Narzim entregar a pista, avançar Chegada a Karavazyan e ativar O Mercado das Correntes.",
    "Quando a pista da Torre estiver clara, ativar O Teste do Fogo.",
    "Quando o grupo escolher patrono/rota, ativar Rumo a Golamra.",
    "Quando a Torre aparecer, concluir Rumo a Golamra e ativar A Torre Sem Guardião."
  ],
  visibilityRules: [
    "A Main Quest pode ser visível desde o começo, com descrição segura.",
    "Subquests devem surgir por gatilho, não todas de uma vez.",
    "Side quests existem como inactive e só viram available quando um NPC, rumor ou cena as ativar.",
    "Tarefas com spoilers devem ser hidden.",
    "Clocks devem ser invisíveis aos jogadores.",
    "Segredos sobre Kuth, Kaoshark, natureza da Torre e verdade de Khar-Volun ficam em gmnotes.",
    "Links para Journals devem apontar para entradas específicas."
  ],
  quests
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");

const byType = quests.reduce((counts, quest) => {
  counts[quest.type] = (counts[quest.type] ?? 0) + 1;
  return counts;
}, {});
console.log(`Blueprint escrito: ${OUT_FILE}`);
console.log(`Quests: ${quests.length}`, byType);
