/**
 * PHANTOM OS — Conversational Intelligence & Interactive Peer Simulation Engine
 * Забезпечує живе, контекстне спілкування для всіх контактів, груп та автономного ядра PHANTOM.
 */

import { Message, Chat } from '../types/messenger';

export interface AgentReply {
  text: string;
  reactionEmoji?: string;
  delayMs: number;
  richData?: Record<string, unknown>;
  authorName?: string;
}

/**
 * Аналізує текст повідомлення та генерує розумну, контекстну відповідь українською мовою
 * залежно від персони співрозмовника.
 */
export function generateContextualResponse(
  chat: Chat,
  userMessage: string,
  _history: Message[] = [],
): AgentReply {
  const text = userMessage.trim().toLowerCase();
  const title = chat.title || '';
  const cleanTitle = title.toLowerCase();

  // 1. AI SPECIALIZED COGNITIVE AGENTS
  if (cleanTitle.includes('architect') || chat.id === 'chat_ai_architect') {
    return generateArchitectResponse(text, userMessage);
  }

  if (cleanTitle.includes('programmer') || cleanTitle.includes('coder') || chat.id === 'chat_ai_coder') {
    return generateCoderResponse(text, userMessage);
  }

  if (cleanTitle.includes('app') || cleanTitle.includes('maker') || chat.id === 'chat_ai_app_maker') {
    return generateAppMakerResponse(text, userMessage);
  }

  // 1.1 PHANTOM AI CORE
  if (
    cleanTitle.includes('phantom') ||
    chat.handle?.toLowerCase().includes('phantom') ||
    chat.type === 'phantom'
  ) {
    return generatePhantomResponse(text, userMessage);
  }

  // 2. KYRYLO (Product Designer & UI Architect)
  if (cleanTitle.includes('kyrylo') || cleanTitle.includes('кирило') || chat.handle?.includes('kyrylo')) {
    return generateKyryloResponse(text, userMessage);
  }

  // 3. ALEX / САНЯ (Backend Engineer)
  if (cleanTitle.includes('саня') || cleanTitle.includes('alex') || cleanTitle.includes('олексій')) {
    return generateAlexResponse(text, userMessage);
  }

  // 4. MARYNA / МАРИНА (QA & Design Systems)
  if (cleanTitle.includes('марина') || cleanTitle.includes('maryna') || cleanTitle.includes('дарина')) {
    return generateMarynaResponse(text, userMessage);
  }

  // 5. OLEKSANDR / ОЛЕКСАНДР (Infrastructure & Mesh Lead)
  if (cleanTitle.includes('олександр') || cleanTitle.includes('oleksandr')) {
    return generateOleksandrResponse(text, userMessage);
  }

  // 6. FAMILY & FRIENDS
  if (chat.circle === 'family' || cleanTitle.includes('мама') || cleanTitle.includes('тато')) {
    return generateFamilyResponse(text, userMessage);
  }

  if (chat.circle === 'friends' || cleanTitle.includes('марта') || cleanTitle.includes('тарас')) {
    return generateFriendsResponse(text, userMessage);
  }

  // 7. DEFAULT CONTEXTUAL FALLBACK FOR ANY DM / GROUP
  return generateGenericPeerResponse(title, text, userMessage);
}

function generatePhantomResponse(text: string, raw: string): AgentReply {
  if (text.includes('привіт') || text.includes('вітаю') || text.includes('добр')) {
    return {
      text: 'Вітаю, операторе. Автономний вузол PHANTOM активний. Усі сенсори, памʼять та захищений P2P-канал у нормі. Що аналізуємо?',
      reactionEmoji: '⚡',
      delayMs: 800,
    };
  }

  if (text.includes('статус') || text.includes('стан') || text.includes('система')) {
    return {
      text: 'Системний статус: GHOST L5 (повна автономність). Затримка вузла 12 мс, наскрізне шифрування активне, звʼязок безпосередній. Черга відкладених завдань порожня.',
      reactionEmoji: '🛡️',
      delayMs: 1000,
    };
  }

  if (text.includes('дзвін') || text.includes('виклик') || text.includes('голос')) {
    return {
      text: 'Голосовий та відеоканал готові до роботи через WebRTC & Opus. Натисни кнопку дзвінка в шапці для тестового зʼєднання.',
      reactionEmoji: '📞',
      delayMs: 900,
    };
  }

  if (text.includes('код') || text.includes('розробк') || text.includes('баг')) {
    return {
      text: 'Архітектура інтерфейсу перевірена. Реактивні стрічки, міжвкладкова шина Mesh Bus та шифрування локальних блобів працюють стабільно.',
      reactionEmoji: '💻',
      delayMs: 1100,
    };
  }

  if (text.includes('дякую') || text.includes('супер') || text.includes('чудово') || text.includes('топ')) {
    return {
      text: 'Завжди до послуг. Цифровий симбіонт готовий до подальших завдань.',
      reactionEmoji: '🔥',
      delayMs: 700,
    };
  }

  return {
    text: `Опрацював запит: «${raw.trim()}». Контекст збережено в Project Memory Graph. Якщо потрібна дія по системі або створення віджету — готовий виконати.`,
    reactionEmoji: '✨',
    delayMs: 1000,
  };
}

function generateKyryloResponse(text: string, raw: string): AgentReply {
  if (text.includes('привіт') || text.includes('хай') || text.includes('ку') || text.includes('добр')) {
    return {
      text: 'Привіт! Я якраз перевіряю новий дизайн компонентів та ергономіку карток на Подолі. Як у тебе справи?',
      reactionEmoji: '👋',
      delayMs: 1100,
    };
  }

  if (text.includes('як справи') || text.includes('як ти') || text.includes('що робиш')) {
    return {
      text: 'Все супер, працюю над архітектурою релізу v2.5 та тестую живий обмін між вузлами. Пʼю фільтр-каву і шліфую деталі інтерфейсу ☕',
      reactionEmoji: '⚡',
      delayMs: 1200,
    };
  }

  if (text.includes('дзвін') || text.includes('набери') || text.includes('зателефонуй') || text.includes('поговоримо')) {
    return {
      text: 'Давай! Натискай кнопку аудіо або відео в шапці — я одразу візьму слухавку і протестуємо WebRTC.',
      reactionEmoji: '📞',
      delayMs: 900,
    };
  }

  if (text.includes('тест') || text.includes('перевір') || text.includes('працює') || text.includes('повідомленн')) {
    return {
      text: 'Бачу твоє повідомлення! Все надходить миттєво через реальну шину. Звʼязок ідеальний 🚀',
      reactionEmoji: '🔥',
      delayMs: 1000,
    };
  }

  if (text.includes('де ти') || text.includes('локаці') || text.includes('де зустрінемось')) {
    return {
      text: 'Я зараз біля Воздвиженки / Подолу. Якщо що, можу скинути геолокацію прямо сюди в чат!',
      reactionEmoji: '📍',
      delayMs: 1200,
    };
  }

  return {
    text: `Зрозумів тебе щодо «${raw.trim()}». Повністю підтримую, зараз врахую це у робочій версії!`,
    reactionEmoji: '👍',
    delayMs: 1100,
  };
}

function generateAlexResponse(text: string, raw: string): AgentReply {
  if (text.includes('привіт') || text.includes('добр')) {
    return {
      text: 'Привіт! Я на звʼязку. Дивлюсь метрики бекенду та вебсокети, що нового?',
      reactionEmoji: '👋',
      delayMs: 900,
    };
  }

  if (text.includes('сервер') || text.includes('апі') || text.includes('бек') || text.includes('база')) {
    return {
      text: 'На бекенді всі роути FastAPI та WebSockets підняті. RTT менше 15мс, синхронізація без затримок.',
      reactionEmoji: '⚡',
      delayMs: 1000,
    };
  }

  if (text.includes('дзвін') || text.includes('голос') || text.includes('тест')) {
    return {
      text: 'Готовий до дзвінка, мікрофон і кодек Opus налаштовані. Набирай!',
      reactionEmoji: '📞',
      delayMs: 800,
    };
  }

  return {
    text: `Прийняв: «${raw.trim()}». Оновлюю гілку та перевіряю у тестах.`,
    reactionEmoji: '🚀',
    delayMs: 1000,
  };
}

function generateMarynaResponse(text: string, raw: string): AgentReply {
  if (text.includes('привіт') || text.includes('добр')) {
    return {
      text: 'Привіт! Тестую нові модалки та кольорову гаму на мобільному екрані. Все виглядає дуже стильно ✨',
      reactionEmoji: '🌸',
      delayMs: 1000,
    };
  }

  if (text.includes('дизайн') || text.includes('макет') || text.includes('колір') || text.includes('ui')) {
    return {
      text: 'Так, органічні токени та теплі відтінки sunrise-warm лягли чудово. Читабельність тексту ідеальна.',
      reactionEmoji: '🎨',
      delayMs: 1100,
    };
  }

  return {
    text: `Чудово! Зафіксувала «${raw.trim()}» у чек-листі тестування.`,
    reactionEmoji: '🧡',
    delayMs: 1000,
  };
}

function generateOleksandrResponse(text: string, raw: string): AgentReply {
  if (text.includes('привіт') || text.includes('добр')) {
    return {
      text: 'Вітаю! Моніторю стабільність P2P звʼязку між вузлами. Все працює штатно.',
      reactionEmoji: '🤝',
      delayMs: 1000,
    };
  }

  return {
    text: `Погоджено: «${raw.trim()}». Дані зафіксовані у журналі аудиту.`,
    reactionEmoji: '✅',
    delayMs: 1100,
  };
}

function generateFamilyResponse(text: string, _raw: string): AgentReply {
  if (text.includes('привіт') || text.includes('добр')) {
    return {
      text: 'Кириле, привіт, рідний! Як ти? Заїдеш сьогодні на вечерю? Я приготувала свіжий яблучний пиріг 🥧',
      reactionEmoji: '🧡',
      delayMs: 1200,
    };
  }

  return {
    text: `Добре, любий! Чекаємо на тебе. Напиши, як звільнишся!`,
    reactionEmoji: '💛',
    delayMs: 1100,
  };
}

function generateFriendsResponse(text: string, raw: string): AgentReply {
  if (text.includes('привіт') || text.includes('добр') || text.includes('хай')) {
    return {
      text: 'Привіт! Ми вже збираємося на терасі біля Подолу 🌿 Підтягуйся, як будеш вільний!',
      reactionEmoji: '☕',
      delayMs: 1100,
    };
  }

  return {
    text: `Домовились щодо «${raw.trim()}»! Скоро побачимось.`,
    reactionEmoji: '🎉',
    delayMs: 1000,
  };
}

function generateArchitectResponse(_text: string, raw: string): AgentReply {
  return {
    text: `🏛️ **Сократівський аналіз гіпотези**: «${raw.trim()}»\n\n1. **Критичне припущення**: Чи враховуємо ми крайові стани при розриві P2P звʼязку?\n2. **Матриця ризиків**: Потенційна розсинхронізація локального Vault та віддаленого вузла.\n3. **Пропозиція**: Зафіксувати це рішення як CRDT-гілку у Tree of Thought для стрес-тесту.`,
    reactionEmoji: '🏛️',
    delayMs: 900,
    authorName: 'Thought Architect',
  };
}

function generateCoderResponse(_text: string, raw: string): AgentReply {
  return {
    text: `💻 **Когнітивний аналіз коду & AST**: «${raw.trim()}»\n\n* Складність: O(1) вибірка з локального IndexedDB кешу.\n* Перевірка типів TypeScript: 100% покриття без \`any\`.\n* Пісочниця WebAssembly: готовий до виконання та заміру затримки (ms) у Canvas.`,
    reactionEmoji: '💻',
    delayMs: 800,
    authorName: 'Pair Programmer',
  };
}

function generateAppMakerResponse(_text: string, raw: string): AgentReply {
  return {
    text: `🎨 **Генератор інтерактивних додатків**:\n\nЯ створив новий інтерактивний React-віджет під запит: «${raw.trim()}». Відкрий **Dynamic Artifact Studio** у правому Canvas, щоб випробувати його наживо!`,
    reactionEmoji: '🎨',
    delayMs: 850,
    authorName: 'App Studio',
  };
}

function generateGenericPeerResponse(title: string, _text: string, raw: string): AgentReply {
  const shortName = title.split(' ')[0] || 'Співрозмовник';
  const replies = [
    `Привіт! Отримав твоє повідомлення: «${raw.trim()}». Все на звʼязку!`,
    `Зрозумів, дякую! Опрацьовую це прямо зараз.`,
    `Так, повністю згоден з тобою щодо цього.`,
    `Прийнято! Перевірив, все виглядає відмінно 🚀`,
  ];

  return {
    text: replies[Math.floor(Math.random() * replies.length)],
    reactionEmoji: '👍',
    delayMs: 1000,
    authorName: shortName,
  };
}

