/*
  Конфіг ESLint для фронту ПК.

  Навіщо він зʼявився. `npm run lint` у цьому дереві не запускався **взагалі**:
  ESLint 9 шукає плаский конфіг (`eslint.config.*`), а в дереві не було ні
  його, ні навіть старого `.eslintrc*` — перевірено пошуком по всьому
  репозиторію. Тобто лінтер мовчав не тому, що код чистий, а тому, що не
  стартував; і жоден із фронтів цього не помітив, бо мовчання лінтера
  виглядає точно так само, як його схвалення.

  Це рівно той клас, який ми тут виполюємо весь час: **інструмент, який ніби
  є, і якого насправді немає.**

  Правила навмисно скромні. Мета цього коміта — щоб лінтер ПОБІГ і показав
  правду, а не щоб одразу перефарбувати дерево. Жорсткішати можна потім,
  коли буде видно реальну кількість зауважень; вмикати все й одразу означало
  б отримати тисячу помилок і знову вимкнути перевірку — тобто повернутись
  туди, звідки почали.
*/
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    // Не наш код і не наші артефакти. `dist` і `src-tauri/target` — це
    // вихід збірки; лінтувати їх означає міряти чужу роботу.
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      // Разові зонди в корені фронту (`_*.mjs`) — риштування, не продукт.
      '_*.mjs',
      // Чужий мінімізований бандл детектора голосу — не наш код.
      'public/vad/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // `no-undef` для TS вимикаємо свідомо: типи й декларації він читає як
      // невідомі імена, а справжні невизначені змінні ловить сам tsc, і
      // ловить точніше. Лишити його означало б потонути в хибних спрацюваннях.
      'no-undef': 'off',
      // Те саме для перевизначень, які в TS законні (перевантаження).
      'no-redeclare': 'off',

      // Невживане — попередження, не помилка: у дереві є навмисні заглушки
      // параметрів, і зупиняти на них збірку зараз передчасно.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` у цьому дереві трапляється на межах із бекендом; це борг,
      // але не той, який лікують зупинкою лінтера.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // Додано 30.08 за знахідкою з месенджера. Там стояв блок
      //     if (inlineEditingFolderId && false) { … }
      // із коментарем «keep references active» — тобто **навмисний
      // глушник**, поставлений, щоб компілятор не скаржився на невживані
      // функції. За ним ховалось те, що «Перейменувати папку» не
      // перейменовує нічого: обробник ставив стан, на який ніхто не
      // дивиться, а поля перейменування в дереві не існувало.
      //
      // Урок ширший за правило: мовчання лінтера виглядає як схвалення —
      // і **мовчання компілятора теж**, причому його можна купити однією
      // фальшивою умовою. `no-constant-condition` ловить це лише в
      // умовах; `no-constant-binary-expression` дістає й у виразах.
      'no-constant-binary-expression': 'error',
    },
  },
  {
    // Аудіо-ворклети живуть у власному глобальному оточенні (AudioWorklet
    // scope), де немає ні `window`, ні `document`, зате є `sampleRate` і
    // `registerProcessor`. Без цього блоку лінтер лаявся б на справний код —
    // а сторож, що б'є по правильному, швидко привчає його вимикати.
    files: ['**/*.worklet.{js,ts}', 'src/workers/**'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
        currentFrame: 'readonly',
      },
    },
  },
  {
    // Прості скрипти в `public/` — звичайний браузерний код без збірки.
    // Без цього блоку вони давали 17 із 20 помилок дерева, і ВСІ хибні:
    // лінтер не знав про `window`/`document`, хоч файли правильні. Сторож,
    // що б'є по справному, швидко привчає читати повз нього — і тоді
    // справжнє зауваження теж пройде повз очі.
    files: ['public/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
      sourceType: 'script',
    },
    rules: {
      // Та сама угода, що вже діє для TS: підкреслення означає «знаю, що не
      // вживається». Без цього рядка `catch (_)` у splash.js читався б як борг.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Тести й стенди: там навмисно є моки, порожні функції й доступ до
    // глобалів, яких у продукті немає.
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}', 'src/test-setup.ts', 'e2e/**'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
];
