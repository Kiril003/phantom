/**
 * Ф1.5 — людські пояснення налаштувань.
 *
 * Бекенд (routes_settings.py) віддає description="" для всіх ключів.
 * Доктрина чесності: кожен рядок Налаштувань несе назву + пояснення,
 * зрозуміле людині, українською. Це джерело пояснень; коли бекенд
 * колись почне слати власні description — вони переможуть
 * (див. resolveDescription).
 *
 * Тест settings-ia.test.ts обходить реєстр бекенда і доводить, що
 * жоден ключ не лишився без пояснення.
 */

import type { SettingDefinition } from '@shared/types';

export const SETTING_DESCRIPTIONS: Readonly<Record<string, string>> = {
  /* ── general ── */
  system_hostname:
    'Імʼя цього вузла — ним він представляється в мережі та телефону в парі.',
  log_level: 'Скільки писати в журнал: DEBUG — усе, ERROR — лише помилки.',
  debug: 'Режим налагодження бекенда: докладніші помилки, більше службових записів.',
  serial_enabled:
    'Міст до аксесуара ESP32 через послідовний порт. Без пристрою нічого не робить.',
  log_json_enabled:
    'Журнал у форматі JSON — для збирачів логів; вимкнено — звичайний текст.',
  deployment_mode:
    'Як цей екземпляр себе мислить: один вузол чи кілька. Задається при розгортанні.',

  /* ── theme ── */
  ui_theme: 'Палітра інтерфейсу: світла, бурштинова нічна або холодна кіберпалуба.',
  ui_language: 'Мова інтерфейсу. Перемикається одразу, без перезапуску.',
  ui_density: 'Щільність елементів: компактніше або просторіше.',
  ui_color_cyan: 'Акцентний колір стану ФОКУС.',
  ui_color_warning: 'Акцентний колір стану СОН.',
  ui_color_success: 'Акцентний колір стану ПРИВИД.',
  ui_color_danger: 'Акцентний колір стану ВАРТА.',
  ui_color_dream: 'Колір накладки стану DREAM.',
  ui_animation_speed: 'Множник тривалості анімацій: менше — швидше.',
  ui_font_size: 'Базовий розмір шрифту всього інтерфейсу.',

  /* ── auth ── */
  security_auto_login:
    'Входити без PIN на цьому пристрої. Зручно вдома, небезпечно в дорозі.',
  security_session_timeout_m:
    'Через скільки хвилин тиші сесія закінчується і треба ввійти знову.',
  security_max_pin_attempts: 'Скільки невдалих спроб PIN до блокування входу.',
  security_lockout_duration_m:
    'На скільки хвилин блокується вхід після вичерпання спроб.',
  security_dangerous_cmd_confirm:
    'Питати підтвердження перед небезпечними командами термінала.',
  security_ghost_auto_encrypt: 'Автоматично шифрувати записи в режимі ПРИВИД.',
  security_trust_xff:
    'Довіряти заголовку X-Forwarded-For — лише якщо попереду стоїть reverse-proxy.',
  security_trusted_proxies:
    'Адреси проксі, чиїм заголовкам можна вірити. Порожньо — нікому.',

  /* ── chat ── */
  chat_tools_enabled:
    'Дозволити ШІ викликати інструменти прямо з чату: таймери, файли, мапу.',
  chat_tool_call_timeout_s:
    'Скільки секунд чекати один виклик інструмента, перш ніж зупинити.',
  chat_tool_max_total_ms:
    'Загальний бюджет часу на всі інструменти в одній відповіді, мс.',
  chat_tool_max_calls_per_turn:
    'Скільки викликів інструментів дозволено за одну відповідь.',
  chat_prompt_logging_enabled:
    'Писати промпти в журнал для налагодження. Промпти можуть містити особисте.',
  chat_prompt_excerpt_max_chars:
    'Скільки символів промпта потрапляє в журнал.',

  /* ── sensors ── */
  sensor_batch_interval_ms: 'Як часто ESP32 шле пакет показів, мс.',
  sensor_serial_port: 'Шлях до порту, де сидить ESP32, наприклад /dev/ttyUSB0.',
  sensor_serial_baud: 'Швидкість послідовного порту. Має збігатися з прошивкою.',
  sensor_radar_sensitivity: 'Чутливість радара присутності.',
  sensor_radar_max_distance_cm: 'Далі цієї відстані радар не зважає, см.',
  sensor_breathing_detection: 'Розпізнавати дихання радаром.',
  sensor_gps_enabled: 'Читати GPS з аксесуара.',
  sensor_wifi_scan_enabled: 'Сканувати Wi-Fi мережі довкола (вардрайвінг).',
  sensor_wifi_scan_interval_s: 'Пауза між скануваннями Wi-Fi, с.',
  sensor_oled_brightness: 'Яскравість OLED-екранчика аксесуара.',

  /* ── ai ── */
  ai_primary_provider:
    'Хто відповідає першим: хмарний Gemini чи локальна Ollama.',
  ai_fallback_provider:
    'Запасний шлях, коли головний провайдер мовчить чи не встигає.',
  ai_timeout_s:
    'Скільки секунд чекати головного провайдера до перемикання на запасний.',
  ai_gemini_model: 'Яка модель Gemini відповідає.',
  ai_gemini_api_key: 'Ключ Gemini API. Зберігається лише на цьому вузлі.',
  ai_ollama_model: 'Локальна модель Ollama — працює без інтернету.',
  ai_ollama_host: 'Де слухає Ollama: адреса і порт.',
  ai_temperature:
    'Наскільки вільні відповіді: 0 — сухо і точно, вище — сміливіше.',
  ai_max_tokens: 'Стеля довжини однієї відповіді, в токенах.',
  ai_top_p: 'Ядерна вибірка: яку частку ймовірної маси слів розглядати.',
  ai_response_language: 'Мова, якою ШІ відповідає.',
  ai_initiative_enabled: 'Дозволити ШІ озиватися першим, без запитання.',
  ai_streaming: 'Показувати відповідь у міру народження, а не всю одразу.',
  will_enabled: '«Воля» — фоновий цикл власних рішень системи.',
  will_tick_interval_s: 'Крок циклу волі, с.',
  will_daily_llm_calls: 'Денна стеля викликів моделі для волі.',
  will_daily_token_cap: 'Денна стеля токенів для волі.',

  /* ── voice ── */
  voice_stt_mode: 'Який рушій слухає: точний Whisper чи миттєвий Vosk.',
  voice_stt_language: 'Мова розпізнавання мовлення.',
  voice_stt_whisper_model: 'Розмір моделі Whisper: більша — точніша, повільніша.',
  voice_stt_whisper_device: 'Де рахує Whisper: CPU чи GPU.',
  voice_tts_enabled: 'Озвучувати відповіді голосом.',
  voice_tts_voice: 'Яким голосом говорити.',
  voice_tts_speed: 'Темп мовлення.',
  voice_tts_emotion_scale: 'Наскільки емоційно звучить голос.',
  voice_tts_state_adaptation: 'Підлаштовувати голос під стан системи.',
  voice_wake_word_enabled: 'Прокидатися на слово-виклик.',
  voice_wake_words: 'Слова, на які система відгукується.',
  voice_always_on_enabled:
    'Застарілий перемикач: тепер це робить «Голосовий режим».',
  voice_wake_confidence_min:
    'Поріг упевненості, з якого слово-виклик вважається почутим.',
  voice_continuation_window_s:
    'Скільки секунд після відповіді можна говорити без нового виклику.',
  voice_mic_duck_on_tts:
    'Глушити мікрофон, поки система говорить, — щоб не чути саму себе.',
  voice_mode: 'Вимкнено, постійне слухання чи прокидання на слово.',
  voice_wake_phrase: 'Фраза-виклик.',
  voice_silence_timeout_ms: 'Скільки мс тиші означає, що ти договорив.',
  voice_streaming_partials: 'Показувати текст, поки ти ще говориш.',
  voice_partial_debounce_ms: 'Пауза між оновленнями живого тексту, мс.',
  voice_refine_with_whisper: 'Після Vosk доуточнювати текст Whisper-ом.',
  voice_refine_diff_threshold:
    'Поріг різниці, з якого уточнення замінює перший текст (0…1).',
  voice_stt_npu_enabled:
    'Рахувати Whisper-encoder на NPU (Hexagon) замість CPU.',
  voice_stt_npu_model_path: 'Шлях до NPU-збірки моделі.',
  voice_stt_npu_compute: 'Точність NPU: int8 швидше, fp16 точніше.',

  /* ── vision ── */
  face_tracking_enabled: 'Стежити за обличчям через камеру.',
  face_tracking_auto_switch_profile:
    'Перемикати профіль користувача за впізнаним обличчям.',
  face_tracking_privacy_mode:
    'Приватний режим: стеження без збереження кадрів.',
  face_recognition_threshold: 'Поріг схожості для впізнавання обличчя.',
  face_unknown_lockout_s:
    'На скільки секунд замикатися, побачивши незнайомця.',
  oled_animation_enabled: 'Анімовані очі на OLED аксесуара.',
  oled_animation_speed: 'Темп анімації очей.',
  oled_brightness: 'Яскравість OLED-превʼю.',
  oled_frame_hz: 'Кадрова частота OLED.',

  /* ── agent ── */
  agent_enabled:
    'Головний вимикач агента. Вимкнено — жодних самостійних дій.',
  agent_risk_tolerance:
    'Скільки ризику агент бере сам: 1 — питає про все, 7 — питає рідко.',
  agent_council_for_high_risk:
    'Перед ризикованими діями — голосування ради моделей.',
  agent_max_actions_per_task: 'Стеля дій на одну задачу, щоб не закрутився.',
  agent_max_elapsed_s_per_task: 'Бюджет часу на задачу, с.',
  agent_max_elapsed_s_per_action: 'Бюджет часу на одну дію, с.',
  agent_max_llm_calls_per_task: 'Стеля викликів моделі на задачу.',
  agent_max_llm_calls_per_background_task:
    'Стеля викликів моделі для фонових задач.',
  agent_background_task_timeout_s:
    'Скільки секунд живе фонова задача до зупинки.',
  agent_proactive_enabled:
    'Дозволити агенту самому починати корисні справи.',
  agent_proactive_interval_s:
    'Як часто агент роззирається, чи є що зробити, с.',
  agent_proactive_cooldown_s:
    'Мінімальна пауза між власними ініціативами, с.',
  ambient_guardian_enabled:
    'Фонове стеження за середовищем: повітря, шум, аномалії.',
  ambient_guardian_interval_s: 'Крок сканування середовища, с.',
  ambient_aqi_unhealthy: 'З цього AQI повітря вважається нездоровим.',
  ambient_aqi_hazardous: 'З цього AQI повітря вважається небезпечним.',
  agent_standing_orders_enabled:
    'Постійні накази: правила, які агент перевіряє сам.',
  agent_episodic_memory_enabled:
    'Памʼятати епізоди роботи і згадувати їх у нових задачах.',
  agent_episodic_top_k: 'Скільки минулих епізодів підкладати в промпт.',
  agent_localization_enabled:
    'Дозволити агенту знати, де ти є — з телефона чи мережі.',
  agent_sandbox_profile_default:
    'Пісочниця для команд агента за замовчуванням.',
  cognitive_memory_enabled:
    'Когнітивна памʼять: факти з розмов осідають і поступово забуваються.',
  cognitive_memory_decay_half_life_days:
    'За скільки днів вага факту тане вдвічі.',
  cognitive_memory_semantic_similarity_threshold:
    'Поріг схожості, з якого факти вважаються про те саме.',
  cognitive_memory_idle_timeout_min:
    'Хвилини тиші, після яких памʼять консолідується.',
  cognitive_memory_disclosure_threshold:
    'Наскільки важливим має бути факт, щоб система сама його згадала.',

  /* ── personality ── */
  agent_emotion_enabled:
    'Внутрішній емоційний стан агента, що впливає на тон.',
  agent_reflection_every_n_actions:
    'Через скільки дій агент зупиняється й переосмислює план.',

  /* ── map ── */
  ui_map_default_zoom: 'Наближення мапи при відкритті.',
  ui_map_style: 'Стиль підложки мапи.',
  agent_browser_geolocation_enabled:
    'Брати позицію з геолокації браузера, коли телефон мовчить.',
  wardriving_cell_precision: 'Розмір клітинки агрегації Wi-Fi записів.',
  wardriving_heatmap_precision: 'Роздільність теплокарти сигналу.',
};

/**
 * Пояснення для рядка: бекендове description перемагає (коли зʼявиться),
 * далі — цей реєстр. Нема ніде — чесна порожнеча (''), НЕ вигадка;
 * тест покриття не дасть такому ключу дожити до релізу.
 */
export function resolveDescription(def: Pick<SettingDefinition, 'key' | 'description'>): string {
  if (def.description && def.description.trim().length > 0) {
    return def.description;
  }
  return SETTING_DESCRIPTIONS[def.key] ?? '';
}
