/**
 * ЕКРАНИ, ЯКІ ВИГАДУЮТЬ ФАКТИ — ВХІД ЗАЧИНЕНО ДО БЕТИ (30.08.2026).
 *
 * Критерій рівно один: **екран вигадує чи йому бракує даних?**
 *  • вигадує — ховаємо. Він не порожній, він стверджує роботу, якої немає,
 *    і людина не має способу це побачити;
 *  • бракує — лишаємо з чесним порожнім станом, як робимо скрізь.
 * Ховаємо брехню, не незавершеність.
 *
 * Що саме тут вигадувалось (виміряно, не на око):
 *  • `SecOpsComplianceModal` — журнал аудиту безпеки з часом «26.08 23:14:02»,
 *    іменами «Кирило (@kiril_root)», «Марина (@marina_core)» і хешами;
 *  • `AutonomousOpsWarRoomModal` — «War Room Active», «Голосування арбітрів»
 *    і аварія «Database Replica Sync Timeout on Radxa-03» — на платформі,
 *    яку ми з цілей зняли;
 *  • `DisasterMeshDtnModal` — вузол `node_alpha_radxa`, «Active», «100 Mbps»;
 *  • `TimeMachineSnapshotModal` — знімки `snap_3` з «Кирило (ROOT)» і `0x8f2a41c`;
 *  • `RoleScopesModal`, `SpaceVaultModal` — люди `u_kiril`/`u_sanya`, вердикти
 *    «passed»/«rejected»;
 *  • `NodeDashboardModal` — «Full-Cone STUN», «Direct P2P Linked».
 * Жоден із них не має джерела даних: ні `messengerApi`, ні будь-якого стору.
 *
 * КОД ЦІЛИЙ І НЕ ВИДАЛЕНИЙ. Замок знімається по одному, і умова повернення
 * одна: **екран читає справжні дані**. Тоді прибрати його ключ із переліку
 * нижче — більше нічого робити не треба.
 *
 * КРИТЕРІЙ «ДЖЕРЕЛА ДАНИХ» — виправлений після того, як власний тест мене
 * спіймав. Спершу я вважав джерелом будь-який стор. Хибно: `WebhooksManagerModal`
 * бере дані з `useWorkOsStore` і показує «GitHub Repository Push Webhook»,
 * «Активний», `token: ph_sec_9938218`. Заміряв стори: до мережі дістають лише
 * `messengerStore`, `authStore`, `aiSynthesisStore`; а `workOsStore` (13
 * записів-літералів) і `agenticStore` (3) **до мережі не ходять узагалі** й
 * засіяні вигаданими задачами — «Інтеграція P2P Mesh каналу для дзвінків»,
 * «PHANTOM OS Unified Blueprint». Стор між екраном і вигадкою нічого не
 * змінює: **джерело — це вузол, а не проміжна змінна.**
 *
 * Відкритими лишились двоє: `CommandPaletteModal` (його 58 «записів» — це
 * перелік команд, не дані про роботу) і `LiveTerminalModal` (справжня
 * поверхня, вигаданого виводу не має).
 */
export const HIDDEN_UNTIL_WIRED = new Set<string>([
  // Додано 30.08.2026, другою хвилею. Перша хвиля їх ПРОПУСТИЛА, і причина
  // повчальна: ключі я витягав шаблоном `shownModal === '...' && <Компонент`,
  // а сім модалок написані у формі `&& (` з переносом рядка. Тобто замок
  // накрив 50 дверей із 57, і саме тому нижче стоїть сторож, який звіряє
  // ПЕРЕЛІК КЛЮЧІВ, а не покладається на моє око.
  //
  // Що за ними:
  //  * `roleScopes` — люди `u_kiril`/`u_sanya` з ролями;
  //  * `workspaceDrive` — `useWorkOsStore`, який до мережі не ходить і сидить
  //    на літералі `INITIAL_DRIVE`;
  //  * `liveTerminal` — вигадане рукостискання вузлів із `Math.random()`
  //    замість затримок і `did:phantom:radxa_arm64_0x8f2a` — ідентифікатор
  //    платформи, ЗНЯТОЇ з цілей;
  //  * `p2pCompute`, `p2pSwarm` — `useMeshStore`, засіяний вигаданими вузлами
  //    «Radxa Rock 5B», «Cloudflare Edge Gateway (Prague)», без жодного
  //    звертання до мережі.
  'liveTerminal',
  'p2pCompute',
  'p2pSwarm',
  'roleScopes',
  'workspaceDrive',
  'dataGrid',
  'memoryGraph',
  'academicLms',
  'academyHub',
  'advancedResearch',
  'agenticRuntime',
  'ambientContext',
  'automations',
  'autonomousOps',
  'blueprint',
  'breadcrumbsPeek',
  'canvasPresentation',
  'codeDiffMathHex',
  'collaborativeWhiteboard',
  'commerceMicroApps',
  'communityClub',
  'corporateHR',
  'creativeStudio',
  'dataLifecycle',
  'disasterMesh',
  'familyHub',
  'gitDevOps',
  'headlessInfra',
  'humanCentricBio',
  'iotTelemetry',
  'knowledgeSearch',
  'loRaWalkie',
  'localErpEscrow',
  'mediaAnnotation',
  'neuroErgonomics',
  'nodeDashboard',
  'personalWellness',
  'phantomRuntime',
  'physicalComputing',
  'planningPokerGantt',
  'protocolSchema',
  'resourceGovernance',
  'secOpsCompliance',
  'semanticBus',
  'spaceVault',
  'spatialMultiPane',
  'spatialProjections',
  'spotlightBounties',
  'stateMachinePipeline',
  'timeMachine',
  'universalBridge',
  'wasmSandbox',
  'webhooks',
  'zeroLeakSecurity',
  'zeroTrace',
]);

/**
 * Пункти командної палітри, що ведуть у зачинені екрани.
 *
 * Замок на самому екрані — половина справи. Якщо пункт лишити в переліку,
 * людина натисне й **не отримає нічого**: ми проміняли б брехню на мертву
 * кнопку, а це те саме сімейство. З 58 записів палітри 45 вели у зачинене.
 *
 * Перелік знімається разом із відповідним ключем із `HIDDEN_UNTIL_WIRED`.
 */
export const HIDDEN_COMMAND_IDS = new Set<string>([
  'act_academiclms',
  'act_agentic',
  'act_ambient',
  'act_automations',
  'act_biocontext',
  'act_blueprint',
  'act_breadcrumbs',
  'act_bridge',
  'act_codediff',
  'act_commerce',
  'act_corporatehr',
  'act_datagrid',
  'act_disaster',
  'act_erp',
  'act_gitdevops',
  'act_governance',
  'act_headless',
  'act_iot',
  'act_lifecycle',
  'act_lora',
  'act_mediaannot',
  'act_multipane',
  'act_neuro',
  'act_physical',
  'act_poker',
  'act_presentation',
  'act_projections',
  'act_research',
  'act_schema',
  'act_secops',
  'act_semanticbus',
  'act_spotlight',
  'act_statemachine',
  'act_timemachine',
  'act_vfs',
  'act_warroom',
  'act_wasm',
  'act_whiteboard',
  'act_zeroleak',
  'act_zerotrace',
  'sphere_academy',
  'sphere_community',
  'sphere_creative',
  'sphere_family',
  'sphere_personal',
]);
