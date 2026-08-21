import React, { useState, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  BarChart3,
  ListTodo,
  Vote,
  Receipt,
  MapPin,
  FileText,
  Code2,
  Calendar,
  Check,
  Plus,
  Trash2,
  Sparkles,
  Users,
  Clock,
  CalendarCheck,
  Video
} from 'lucide-react';
import { Chat, ChatMember, EventAttendee, EventData, Message } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface ActionHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertAction: (actionPayload: any) => void;
  chat?: Chat;
  initialMessage?: Message | null;
  selectedMessages?: Message[];
  defaultTab?: 'calendar' | 'table' | 'chart' | 'task-list' | 'poll' | 'bill' | 'location' | 'file' | 'code';
}

export const ActionHubModal: React.FC<ActionHubModalProps> = ({
  isOpen,
  onClose,
  onInsertAction,
  chat,
  initialMessage,
  selectedMessages,
  defaultTab = 'calendar',
}) => {
  const [activeTab, setActiveTab] = useState<
    'calendar' | 'table' | 'chart' | 'task-list' | 'poll' | 'bill' | 'location' | 'file' | 'code'
  >(defaultTab);

  // Calendar Sync State
  const [eventTitle, setEventTitle] = useState('Спільний статус-синк та дизайн-рев’ю');
  const [eventDate, setEventDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [eventTime, setEventTime] = useState('15:00');
  const [eventEndTime, setEventEndTime] = useState('16:00');
  const [eventLocation, setEventLocation] = useState('📍 Онлайн (Google Meet)');
  const [eventDescription, setEventDescription] = useState('Узгодження деталей проекту, пріоритетів та наступних кроків.');
  const [calendarTarget, setCalendarTarget] = useState<'google' | 'apple' | 'outlook' | 'aura'>('google');
  const [selectedAttendeeIds, setSelectedAttendeeIds] = useState<string[]>([]);
  const [extractedSourceSnippet, setExtractedSourceSnippet] = useState<string | null>(null);

  // Table form state
  const [tableTitle, setTableTitle] = useState('План завдань та витрат');
  const [tablePreset, setTablePreset] = useState<'sprint' | 'budget' | 'comparison' | 'schedule'>('sprint');

  // Chart form state
  const [chartTitle, setChartTitle] = useState('Динаміка закриття задач за тиждень');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');

  // Task list form state
  const [taskTitle, setTaskTitle] = useState('Список завдань та доручень');
  const [taskItems, setTaskItems] = useState([
    { title: 'Узгодити місце та час зустрічі', assignee: 'Кирило' },
    { title: 'Підготувати порівняльну таблицю', assignee: 'Марта' },
    { title: 'Надіслати підсумковий звіт', assignee: 'Олексій' },
  ]);
  const [newTaskInput, setNewTaskInput] = useState('');

  // Poll form state
  const [pollQuestion, setPollQuestion] = useState('Який час для спільної зустрічі підходить найбільше?');
  const [pollOptions, setPollOptions] = useState([
    'Четвер, 18:00 (Поділ)',
    'П’ятниця, 15:00 (Онлайн)',
    'Субота, 12:00 (Тераса)',
  ]);
  const [newPollOption, setNewPollOption] = useState('');

  // Split bill state
  const [billTitle, setBillTitle] = useState('Спільний рахунок за каву та десерти');
  const [billTotal, setBillTotal] = useState('650');
  const [billCurrency, setBillCurrency] = useState('₴');

  // Location card state
  const [locName, setLocName] = useState('Кав’ярня «Каштан»');
  const [locAddress, setLocAddress] = useState('вул. Рейтарська, 9Б (Київ)');
  const [locCategory, setLocCategory] = useState('спешелті кава · тераса');

  // Code state
  const [codeTitle, setCodeTitle] = useState('DataTransformer.ts');
  const [codeLang, setCodeLang] = useState('typescript');
  const [codeSnippet, setCodeSnippet] = useState(
    `export function formatCurrency(amount: number): string {\n  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' }).format(amount);\n}`
  );

  // File state
  const [fileName, setFileName] = useState('Aura_Product_Roadmap_2026.pdf');
  const [fileSize, setFileSize] = useState('3.4 МБ');

  // Intelligent Context Extraction on Open
  useEffect(() => {
    if (isOpen) {
      if (defaultTab) {
        setActiveTab(defaultTab);
      }

      // Pre-select all chat members
      if (chat?.members && chat.members.length > 0) {
        setSelectedAttendeeIds(chat.members.map((m) => m.id));
      } else {
        setSelectedAttendeeIds(['user_1', 'user_2']);
      }

      // If initialMessage or selectedMessages are passed, parse context
      let rawTextToParse = '';
      if (initialMessage && initialMessage.text) {
        rawTextToParse = initialMessage.text;
      } else if (selectedMessages && selectedMessages.length > 0) {
        rawTextToParse = selectedMessages
          .filter((m) => m.text)
          .map((m) => m.text)
          .join(' ');
      }

      if (rawTextToParse) {
        parseContextAndFillEvent(rawTextToParse);
      }
    }
  }, [isOpen, initialMessage, selectedMessages, chat, defaultTab]);

  const parseContextAndFillEvent = (text: string) => {
    setExtractedSourceSnippet(text);
    const lower = text.toLowerCase();

    // Detect Dates
    const today = new Date();
    if (lower.includes('сьогодні')) {
      setEventDate(today.toISOString().split('T')[0]);
    } else if (lower.includes('завтра')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      setEventDate(tomorrow.toISOString().split('T')[0]);
    } else if (lower.includes('післязавтра')) {
      const dayAfter = new Date(today);
      dayAfter.setDate(dayAfter.getDate() + 2);
      setEventDate(dayAfter.toISOString().split('T')[0]);
    } else if (lower.includes('четвер')) {
      const d = new Date(today);
      const dayOfWeek = d.getDay();
      const distance = (4 + 7 - dayOfWeek) % 7 || 7;
      d.setDate(d.getDate() + distance);
      setEventDate(d.toISOString().split('T')[0]);
    } else if (lower.includes('п’ятниц') || lower.includes("п'ятниц")) {
      const d = new Date(today);
      const dayOfWeek = d.getDay();
      const distance = (5 + 7 - dayOfWeek) % 7 || 7;
      d.setDate(d.getDate() + distance);
      setEventDate(d.toISOString().split('T')[0]);
    } else if (lower.includes('субот')) {
      const d = new Date(today);
      const dayOfWeek = d.getDay();
      const distance = (6 + 7 - dayOfWeek) % 7 || 7;
      d.setDate(d.getDate() + distance);
      setEventDate(d.toISOString().split('T')[0]);
    }

    // Detect Time patterns (18:00, 15:30, 12:00, 14:00)
    const timeMatch = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2];
      const startFormatted = `${hour < 10 ? '0' + hour : hour}:${minute}`;
      const endHour = (hour + 1) % 24;
      const endFormatted = `${endHour < 10 ? '0' + endHour : endHour}:${minute}`;
      setEventTime(startFormatted);
      setEventEndTime(endFormatted);
    }

    // Detect Location
    if (lower.includes('каштан') || lower.includes('рейтарськ')) {
      setEventLocation('📍 Кав’ярня «Каштан» (вул. Рейтарська, 9Б)');
    } else if (lower.includes('поділ') || lower.includes('терас')) {
      setEventLocation('📍 Тераса на Подолі (Контрактова площа)');
    } else if (lower.includes('офіс') || lower.includes('коворкінг')) {
      setEventLocation('🏢 Офісний простір Aura, Зал А');
    } else if (lower.includes('meet') || lower.includes('онлайн') || lower.includes('zoom')) {
      setEventLocation('🎥 Google Meet (https://meet.google.com/aur-sync-hub)');
    }

    // Extract Title & Agenda
    if (chat?.title) {
      setEventTitle(`Зустріч: ${chat.title}`);
    } else if (text.length > 5) {
      const cleanSnippet = text.slice(0, 45).replace(/\n/g, ' ');
      setEventTitle(`${cleanSnippet}${text.length > 45 ? '...' : ''}`);
    }

    setEventDescription(`Автоматично згенеровано з контексту повідомлення: «${text.slice(0, 120)}${text.length > 120 ? '...' : ''}»`);
  };

  if (!isOpen) return null;

  const toggleAttendee = (memberId: string) => {
    soundFx.playTap();
    setSelectedAttendeeIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  // Insert Calendar Event Action
  const handleInsertCalendarEvent = () => {
    soundFx.playSend();

    const membersList: ChatMember[] = chat?.members || [
      { id: 'u_kirill', name: 'Кирило', handle: '@kirill', role: 'owner', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces', isOnline: true },
      { id: 'u_marta', name: 'Марта', handle: '@marta', role: 'member', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=faces', isOnline: true },
    ];

    const attendeeDetails: EventAttendee[] = membersList
      .filter((m) => selectedAttendeeIds.includes(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        status: 'invited',
      }));

    const eventPayload: EventData = {
      id: `evt_${Date.now()}`,
      title: eventTitle.trim(),
      date: eventDate,
      time: eventTime,
      endTime: eventEndTime,
      location: eventLocation.trim(),
      description: eventDescription.trim(),
      attendees: attendeeDetails.map((a) => a.name),
      attendeeDetails,
      calendarType: calendarTarget,
      meetLink: eventLocation.includes('meet.google.com') ? 'https://meet.google.com/aur-sync-hub' : undefined,
      sourceMessageText: extractedSourceSnippet || undefined,
    };

    onInsertAction({
      type: 'event',
      text: `📅 Запрошення на зустріч: «${eventTitle}» (${eventDate} о ${eventTime})`,
      eventData: eventPayload,
    });

    onClose();
  };

  // Insert Table
  const handleInsertTable = () => {
    soundFx.playTap();
    let columns = [
      { key: 'task', label: 'Задача', type: 'text' as const },
      { key: 'assignee', label: 'Відповідальний', type: 'text' as const },
      { key: 'status', label: 'Статус', type: 'badge' as const },
      { key: 'progress', label: 'Прогрес (%)', type: 'number' as const },
    ];
    let rows: Record<string, any>[] = [
      { id: '1', task: 'Проєктування модулів чату', assignee: 'Кирило', status: 'Готово', progress: 100 },
      { id: '2', task: 'Редагування таблиць', assignee: 'Олексій', status: 'Готово', progress: 100 },
      { id: '3', task: 'Тестування доступності WCAG', assignee: 'Дарина', status: 'В процесі', progress: 80 },
    ];

    if (tablePreset === 'budget') {
      columns = [
        { key: 'item', label: 'Стаття витрат', type: 'text' },
        { key: 'category', label: 'Категорія', type: 'badge' },
        { key: 'amount', label: 'Сума (₴)', type: 'number' },
      ];
      rows = [
        { id: '1', item: 'Оренда коворкінгу', category: 'Офіс', amount: 8500 },
        { id: '2', item: 'Підписки на дизайн-сервіси', category: 'Софт', amount: 3200 },
        { id: '3', item: 'Кава та снеки для команди', category: 'Затишок', amount: 1450 },
      ];
    } else if (tablePreset === 'comparison') {
      columns = [
        { key: 'option', label: 'Варіант локації', type: 'text' },
        { key: 'capacity', label: 'Місткість (осіб)', type: 'number' },
        { key: 'score', label: 'Оцінка (1-10)', type: 'number' },
        { key: 'status', label: 'Рішення', type: 'badge' },
      ];
      rows = [
        { id: '1', option: 'Тераса на Подолі', capacity: 15, score: 9.5, status: 'Рекомендовано' },
        { id: '2', option: 'Конференц-зал на Золотих', capacity: 25, score: 8.0, status: 'Резерв' },
      ];
    }

    onInsertAction({
      type: 'table',
      text: `Створено структуровану таблицю: «${tableTitle}»`,
      tableData: {
        title: tableTitle,
        description: 'Інтерактивна таблиця з можливістю редагування клітинок',
        columns,
        rows,
        summaryRow: { task: 'Разом', assignee: 'Команда', status: 'Активно', progress: 93 },
      },
    });
    onClose();
  };

  // Insert Chart
  const handleInsertChart = () => {
    soundFx.playTap();
    onInsertAction({
      type: 'chart',
      text: `Створено інтерактивний графік: «${chartTitle}»`,
      chartData: {
        title: chartTitle,
        type: chartType,
        data: [
          { name: 'Пн', tasks: 8, activity: 14 },
          { name: 'Вт', tasks: 14, activity: 22 },
          { name: 'Ср', tasks: 24, activity: 30 },
          { name: 'Чт', tasks: 19, activity: 28 },
          { name: 'Пт', tasks: 29, activity: 38 },
          { name: 'Сб', tasks: 12, activity: 15 },
          { name: 'Нд', tasks: 6, activity: 10 },
        ],
        keys: [
          { key: 'tasks', label: 'Закриті завдання', color: '#E87A42' },
          { key: 'activity', label: 'Активність обговорень', color: '#528A4B' },
        ],
        takeaway: 'Найвища продуктивність зафіксована у середу та п’ятницю.',
      },
    });
    onClose();
  };

  // Insert Task List
  const handleInsertTaskList = () => {
    soundFx.playTap();
    onInsertAction({
      type: 'task-list',
      text: `Створено список завдань: «${taskTitle}»`,
      taskListData: {
        title: taskTitle,
        tasks: taskItems.map((item, idx) => ({
          id: `t_${idx + 1}`,
          title: item.title,
          completed: false,
          assigneeName: item.assignee,
        })),
      },
    });
    onClose();
  };

  // Insert Poll
  const handleInsertPoll = () => {
    soundFx.playTap();
    onInsertAction({
      type: 'poll',
      text: `Опитування: ${pollQuestion}`,
      pollData: {
        question: pollQuestion,
        options: pollOptions.map((opt, idx) => ({
          id: `opt_${idx + 1}`,
          text: opt,
          votes: 0,
          voters: [],
        })),
        totalVotes: 0,
      },
    });
    onClose();
  };

  // Insert Split Bill
  const handleInsertBill = () => {
    soundFx.playTap();
    const members = chat?.members || [
      { id: '1', name: 'Кирило', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces' },
      { id: '2', name: 'Марта', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=faces' },
      { id: '3', name: 'Олексій', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=faces' },
    ];
    const total = parseFloat(billTotal) || 600;
    const share = Math.round(total / members.length);

    onInsertAction({
      type: 'split-bill',
      text: `Спільний рахунок: «${billTitle}» (${total} ${billCurrency})`,
      splitBillData: {
        title: billTitle,
        totalAmount: total,
        currency: billCurrency,
        participants: members.map((m, idx) => ({
          id: m.id,
          name: m.name,
          avatar: m.avatar,
          share,
          paid: idx === 0,
        })),
        paidCount: 1,
      },
    });
    onClose();
  };

  // Insert Location
  const handleInsertLocation = () => {
    soundFx.playTap();
    onInsertAction({
      type: 'location',
      text: `Локація: ${locName}`,
      locationData: {
        name: locName,
        category: locCategory,
        address: locAddress,
        distance: '450 м',
        walkingTime: '6 хв пішки',
        coords: { lat: 50.4501, lng: 30.5234 },
      },
    });
    onClose();
  };

  // Insert File
  const handleInsertFile = () => {
    soundFx.playTap();
    onInsertAction({
      type: 'file',
      text: `Документ: ${fileName}`,
      fileData: {
        name: fileName,
        size: fileSize,
        extension: fileName.split('.').pop() || 'pdf',
        url: '#',
      },
    });
    onClose();
  };

  // Insert Code
  const handleInsertCode = () => {
    soundFx.playTap();
    onInsertAction({
      type: 'code',
      text: `Сніппет коду: ${codeTitle}`,
      codeData: {
        title: codeTitle,
        language: codeLang,
        code: codeSnippet,
      },
    });
    onClose();
  };

  const membersList: ChatMember[] = chat?.members || [
    { id: 'u_kirill', name: 'Кирило', handle: '@kirill', role: 'owner', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces', isOnline: true },
    { id: 'u_marta', name: 'Марта', handle: '@marta', role: 'member', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=faces', isOnline: true },
    { id: 'u_oleksiy', name: 'Олексій', handle: '@oleksiy', role: 'member', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=faces', isOnline: false },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-[#121A15] border-t sm:border border-[#2B3C30] rounded-t-3xl sm:rounded-3xl w-full max-w-2xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 pb-[var(--sab)] sm:pb-0 text-[#E4EDE7]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#141C16]">
          <div className="w-12 h-1 bg-[#28392C] rounded-full" />
        </div>

        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#1F2B22] flex items-center justify-between bg-[#141C16]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-[#1A261D] text-[#55C778] border border-[#2B3E31] flex items-center justify-center font-bold text-sm sm:text-base shadow-sm">
              ⚡
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white flex items-center gap-2">
                ActionHub · Інтерактивні картки
              </h3>
              <p className="text-[11px] sm:text-xs text-[#8EA093]">
                Створюйте події в календарі, таблиці, графіки, чеки та опитування
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#8EA093] hover:text-white hover:bg-[#1E2A21] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Type Selector Tabs */}
        <div className="px-4 py-2 bg-[#0E1410] border-b border-[#1F2B22] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: 'calendar', label: 'Calendar Sync 📅', icon: Calendar, highlight: true },
            { id: 'table', label: 'Таблиця', icon: FileSpreadsheet },
            { id: 'chart', label: 'Графік', icon: BarChart3 },
            { id: 'task-list', label: 'Чек-лист', icon: ListTodo },
            { id: 'poll', label: 'Опитування', icon: Vote },
            { id: 'bill', label: 'Рахунок', icon: Receipt },
            { id: 'location', label: 'Локація', icon: MapPin },
            { id: 'file', label: 'Документ', icon: FileText },
            { id: 'code', label: 'Сніппет коду', icon: Code2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  soundFx.playTap();
                  setActiveTab(tab.id as any);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#1C2920] text-[#55C778] border border-[#2B3E31] shadow-sm'
                    : 'bg-[#141C16] hover:bg-[#18231B] text-[#8EA093] hover:text-white border border-[#223126]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* TAB 0: CALENDAR SYNC (FEATURED) */}
          {activeTab === 'calendar' && (
            <div className="space-y-4">
              {/* Context Extraction Banner */}
              {extractedSourceSnippet && (
                <div className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl flex items-start gap-2.5">
                  <div className="p-1.5 bg-[#1A261D] text-[#55C778] border border-[#2B3E31] rounded-xl shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-xs text-white">
                        Дані авто-заповнено з контексту бесіди
                      </span>
                      <span className="text-[10px] text-[#55C778] font-bold">✓ Smart Parsed</span>
                    </div>
                    <p className="text-[11px] text-[#8EA093] truncate mt-0.5">
                      «{extractedSourceSnippet}»
                    </p>
                  </div>
                </div>
              )}

              {/* Title & Quick Presets */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#8EA093]">
                  Тема / Назва події
                </label>
                <input
                  type="text"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="наприклад, Sprint Review, Кавовий синк..."
                  className="w-full px-3.5 py-2.5 bg-[#0E1410] border border-[#1F2B22] rounded-2xl text-xs font-bold text-white focus:outline-none focus:border-[#55C778] shadow-sm"
                />

                {/* Preset Chips */}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pt-1">
                  {[
                    '⚡ Sprint Review & Design Sync',
                    '☕ Кавовий синк на терасі',
                    '🎯 Щотижневий статус-мітап',
                    '🏡 Спільна родинна вечеря',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        setEventTitle(preset);
                      }}
                      className="px-2.5 py-1 bg-[#141C16] hover:bg-[#18231B] border border-[#223126] rounded-xl text-[11px] text-[#A4B8AB] hover:text-white whitespace-nowrap transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date & Time Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-[#8EA093] flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-[#55C778]" />
                    Дата
                  </label>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0E1410] border border-[#1F2B22] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-[#55C778]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-[#8EA093] flex items-center gap-1">
                    <Clock className="w-3 h-3 text-[#55C778]" />
                    Початок
                  </label>
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0E1410] border border-[#1F2B22] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-[#55C778]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-[#8EA093] flex items-center gap-1">
                    <Clock className="w-3 h-3 text-[#8EA093]" />
                    Завершення
                  </label>
                  <input
                    type="time"
                    value={eventEndTime}
                    onChange={(e) => setEventEndTime(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0E1410] border border-[#1F2B22] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-[#55C778]"
                  />
                </div>
              </div>

              {/* Location or Video Link */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#8EA093] flex items-center justify-between">
                  <span>Місце зустрічі або посилання</span>
                  <span className="text-[10px] text-[#8EA093]">Фізична адреса або Google Meet</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={eventLocation}
                    onChange={(e) => setEventLocation(e.target.value)}
                    placeholder="📍 Кав’ярня «Каштан», Рейтарська 9Б або Google Meet..."
                    className="flex-1 px-3.5 py-2 bg-[#0E1410] border border-[#1F2B22] rounded-xl text-xs font-medium text-white focus:outline-none focus:border-[#55C778]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      soundFx.playTap();
                      setEventLocation('🎥 Google Meet (https://meet.google.com/aur-sync-hub)');
                    }}
                    className="px-3 py-2 bg-[#141C16] hover:bg-[#18231B] text-white border border-[#223126] rounded-xl text-xs font-bold transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Video className="w-3.5 h-3.5 text-[#55C778]" />
                    <span>Meet</span>
                  </button>
                </div>
              </div>

              {/* Agenda / Description */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#8EA093]">
                  Порядок денний / Опис
                </label>
                <textarea
                  rows={2}
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                  placeholder="Короткі тези зустрічі, посилання на матеріали чи питання для обговорення..."
                  className="w-full p-3 bg-[#0E1410] border border-[#1F2B22] rounded-xl text-xs text-white focus:outline-none focus:border-[#55C778]"
                />
              </div>

              {/* Attendees selection (Pre-filled from chat members) */}
              <div className="space-y-2 p-3 bg-[#141C16] border border-[#223126] rounded-2xl">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#55C778]" />
                    <span>Запрошені учасники ({selectedAttendeeIds.length}/{membersList.length})</span>
                  </label>
                  <span className="text-[10px] text-[#8EA093]">
                    Отримують інтерактивне запрошення з кнопками RSVP
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
                  {membersList.map((member) => {
                    const isSelected = selectedAttendeeIds.includes(member.id);
                    return (
                      <div
                        key={member.id}
                        onClick={() => toggleAttendee(member.id)}
                        className={`p-2 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#1C2920] border-[#55C778] text-white'
                            : 'bg-[#0E1410] border-[#1F2B22] text-[#8EA093] hover:text-white hover:bg-[#141C16]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={member.avatar}
                            alt={member.name}
                            className="w-6 h-6 rounded-lg object-cover ring-1 ring-[#1F2B22]"
                          />
                          <span className="text-xs font-bold truncate">{member.name}</span>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-md flex items-center justify-center border text-[10px] ${
                            isSelected ? 'bg-[#55C778] text-[#0C120E] border-[#55C778]' : 'border-[#223126]'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Target Calendar Provider */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#445047]">
                  Формат синхронізації
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'google', label: 'Google Calendar', icon: '📅' },
                    { id: 'apple', label: 'Apple iCal (.ics)', icon: '🍎' },
                    { id: 'outlook', label: 'Outlook Calendar', icon: '💼' },
                    { id: 'aura', label: 'Aura Team Sync', icon: '✨' },
                  ].map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => setCalendarTarget(target.id as any)}
                      className={`p-2.5 rounded-xl text-xs font-semibold border text-center transition-all flex items-center justify-center gap-1.5 ${
                        calendarTarget === target.id
                          ? 'bg-[#1F2521] text-white border-[#1F2521] shadow-2xs font-bold'
                          : 'bg-white border-[#DFD6C5] text-[#556157] hover:bg-[#FAF6EE]'
                      }`}
                    >
                      <span>{target.icon}</span>
                      <span className="truncate">{target.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Submit Button */}
              <button
                onClick={handleInsertCalendarEvent}
                className="w-full py-3 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-2xl font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-2 mt-2"
              >
                <CalendarCheck className="w-4 h-4" />
                <span>Надіслати запрошення в чат та синхронізувати</span>
              </button>
            </div>
          )}

          {/* TAB 1: TABLE */}
          {activeTab === 'table' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Назва та призначення таблиці
                </label>
                <input
                  type="text"
                  value={tableTitle}
                  onChange={(e) => setTableTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1.5">
                  Шаблон структури
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'sprint', label: 'Спринт задач' },
                    { id: 'budget', label: 'Бюджет & Витрати' },
                    { id: 'comparison', label: 'Порівняння опцій' },
                    { id: 'schedule', label: 'Графік чергувань' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setTablePreset(p.id as any)}
                      className={`p-2.5 rounded-xl text-xs font-semibold border text-center transition-all ${
                        tablePreset === p.id
                          ? 'bg-[#FCE7D8] border-[#E87A42] text-[#8C461A]'
                          : 'bg-white border-[#DFD6C5] text-[#556157] hover:bg-[#FAF6EE]'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-[#FAF4EB] border border-[#E8DFD1] rounded-2xl text-xs text-[#626F66] space-y-1">
                <p className="font-bold text-[#1F2521]">✨ Можливості таблиці в чаті:</p>
                <p>• Пряме редагування будь-якої клітинки в один клік</p>
                <p>• Додавання нових рядків та сортування за колонками</p>
                <p>• Миттєвий експорт у CSV-файл для Excel / Google Sheets</p>
              </div>

              <button
                onClick={handleInsertTable}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Вставити таблицю в чат</span>
              </button>
            </div>
          )}

          {/* TAB 2: CHART */}
          {activeTab === 'chart' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Заголовок графіка
                </label>
                <input
                  type="text"
                  value={chartTitle}
                  onChange={(e) => setChartTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1.5">
                  Тип візуалізації
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'bar', label: 'Стовпчиковий (Bar)' },
                    { id: 'line', label: 'Лінійний (Line)' },
                    { id: 'area', label: 'З областями (Area)' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setChartType(t.id as any)}
                      className={`p-2.5 rounded-xl text-xs font-semibold border text-center transition-all ${
                        chartType === t.id
                          ? 'bg-[#FCE7D8] border-[#E87A42] text-[#8C461A]'
                          : 'bg-white border-[#DFD6C5] text-[#556157] hover:bg-[#FAF6EE]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleInsertChart}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Вставити інтерактивний графік</span>
              </button>
            </div>
          )}

          {/* TAB 3: TASK LIST */}
          {activeTab === 'task-list' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Заголовок списку завдань
                </label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#445047]">
                  Пункти завдань ({taskItems.length})
                </label>
                <div className="space-y-1.5">
                  {taskItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white border border-[#DFD6C5] rounded-xl text-xs">
                      <span className="font-bold text-[#8C461A] w-5">{idx + 1}.</span>
                      <span className="flex-1 font-medium text-[#1F2521]">{item.title}</span>
                      <span className="px-2 py-0.5 bg-[#F2EDE4] rounded text-[10px] font-bold text-[#556157]">{item.assignee}</span>
                      <button
                        onClick={() => setTaskItems(taskItems.filter((_, i) => i !== idx))}
                        className="text-gray-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newTaskInput}
                    onChange={(e) => setNewTaskInput(e.target.value)}
                    placeholder="Додати нове завдання..."
                    className="flex-1 px-3 py-1.5 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTaskInput.trim()) {
                        setTaskItems([...taskItems, { title: newTaskInput.trim(), assignee: 'Всі' }]);
                        setNewTaskInput('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newTaskInput.trim()) {
                        setTaskItems([...taskItems, { title: newTaskInput.trim(), assignee: 'Всі' }]);
                        setNewTaskInput('');
                      }
                    }}
                    className="px-3 py-1.5 bg-[#1F2521] text-white rounded-xl text-xs font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Додати</span>
                  </button>
                </div>
              </div>

              <button
                onClick={handleInsertTaskList}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Вставити чек-лист у чат</span>
              </button>
            </div>
          )}

          {/* TAB 4: POLL */}
          {activeTab === 'poll' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Питання опитування
                </label>
                <input
                  type="text"
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#445047]">
                  Варіанти відповідей
                </label>
                <div className="space-y-1.5">
                  {pollOptions.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white border border-[#DFD6C5] rounded-xl text-xs">
                      <span className="font-bold text-[#8C461A] w-5">{idx + 1}.</span>
                      <span className="flex-1 font-medium text-[#1F2521]">{opt}</span>
                      <button
                        onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                        className="text-gray-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newPollOption}
                    onChange={(e) => setNewPollOption(e.target.value)}
                    placeholder="Додати варіант..."
                    className="flex-1 px-3 py-1.5 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                  />
                  <button
                    onClick={() => {
                      if (newPollOption.trim()) {
                        setPollOptions([...pollOptions, newPollOption.trim()]);
                        setNewPollOption('');
                      }
                    }}
                    className="px-3 py-1.5 bg-[#1F2521] text-white rounded-xl text-xs font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Додати</span>
                  </button>
                </div>
              </div>

              <button
                onClick={handleInsertPoll}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Опублікувати опитування</span>
              </button>
            </div>
          )}

          {/* TAB 5: BILL */}
          {activeTab === 'bill' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Призначення рахунку
                </label>
                <input
                  type="text"
                  value={billTitle}
                  onChange={(e) => setBillTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Загальна сума
                  </label>
                  <input
                    type="number"
                    value={billTotal}
                    onChange={(e) => setBillTotal(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-bold text-[#1F2521] focus:outline-none focus:border-[#E87A42]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Валюта
                  </label>
                  <select
                    value={billCurrency}
                    onChange={(e) => setBillCurrency(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-bold focus:outline-none focus:border-[#E87A42]"
                  >
                    <option value="₴">₴ (Гривня)</option>
                    <option value="$">$ (USD)</option>
                    <option value="€">€ (EUR)</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleInsertBill}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Розділити чек порівну</span>
              </button>
            </div>
          )}

          {/* TAB 6: LOCATION */}
          {activeTab === 'location' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Назва місця / закладу
                </label>
                <input
                  type="text"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Адреса
                </label>
                <input
                  type="text"
                  value={locAddress}
                  onChange={(e) => setLocAddress(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Категорія / Теги
                </label>
                <input
                  type="text"
                  value={locCategory}
                  onChange={(e) => setLocCategory(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <button
                onClick={handleInsertLocation}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Надіслати картку локації</span>
              </button>
            </div>
          )}

          {/* TAB 7: FILE */}
          {activeTab === 'file' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Ім’я документа / файлу
                </label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Розмір файлу
                </label>
                <input
                  type="text"
                  value={fileSize}
                  onChange={(e) => setFileSize(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-medium focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <button
                onClick={handleInsertFile}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Прикріпити документ</span>
              </button>
            </div>
          )}

          {/* TAB 8: CODE */}
          {activeTab === 'code' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Назва файлу
                  </label>
                  <input
                    type="text"
                    value={codeTitle}
                    onChange={(e) => setCodeTitle(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-mono focus:outline-none focus:border-[#E87A42]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Мова
                  </label>
                  <select
                    value={codeLang}
                    onChange={(e) => setCodeLang(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-mono focus:outline-none focus:border-[#E87A42]"
                  >
                    <option value="typescript">TypeScript</option>
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="sql">SQL</option>
                    <option value="json">JSON</option>
                    <option value="html">HTML/CSS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1">
                  Вихідний код
                </label>
                <textarea
                  rows={6}
                  value={codeSnippet}
                  onChange={(e) => setCodeSnippet(e.target.value)}
                  className="w-full p-3 bg-[#1F2521] text-[#A8D5BA] font-mono text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E87A42]"
                />
              </div>

              <button
                onClick={handleInsertCode}
                className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Вставити сніппет коду</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
