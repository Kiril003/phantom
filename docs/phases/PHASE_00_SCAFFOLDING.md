# Фаза 0 — Scaffolding

## Мета
Створити ПОВНУ структуру проєкту: всі файли, папки, конфіги, типи, imports.
Нуль бізнес-логіки, але всі interfaces, types, configs — готові.

## Файли для створення

### Frontend
1. `src/frontend/package.json` — всі залежності
2. `src/frontend/vite.config.ts`
3. `src/frontend/tsconfig.json` — strict mode
4. `src/frontend/tailwind.config.ts` — кольорова мова PHANTOM
5. `src/frontend/index.html` — 1024×600 viewport
6. `src/frontend/src/main.tsx` — entry point
7. `src/frontend/src/app/App.tsx` — router + providers
8. `src/frontend/src/app/providers.tsx` — QueryClient, WebSocket, Zustand
9. `src/frontend/src/styles/globals.css` — CSS variables, animations base
10. `src/frontend/src/services/api.ts` — typed API client
11. `src/frontend/src/services/websocket.ts` — WS client з reconnect
12. `src/frontend/src/stores/` — Zustand stores (stubs з типами)

### Shared Types
13. `src/shared/types/system.ts` — SystemState, StateTransition
14. `src/shared/types/context.ts` — ContextSnapshot
15. `src/shared/types/sensors.ts` — SensorBatch
16. `src/shared/types/commands.ts` — ActuatorCommand
17. `src/shared/types/user.ts` — User, UserPreferences, BehavioralModel
18. `src/shared/types/chat.ts` — ChatMessage, ChatSession, ResponseForm
19. `src/shared/types/memory.ts` — MemoryFact, TemporalAnchor
20. `src/shared/types/wardriving.ts` — WardrivingRecord, MapPOI
21. `src/shared/types/settings.ts` — SettingsCategory, SettingDefinition
22. `src/shared/types/index.ts` — re-export all

### Backend
23. `src/backend/requirements.txt` — всі залежності
24. `src/backend/main.py` — FastAPI app factory + lifespan
25. `src/backend/config.py` — Pydantic Settings
26. `src/backend/db/database.py` — async SQLAlchemy setup
27. `src/backend/db/models.py` — всі ORM models (columns, relations)
28. `src/backend/api/websocket_hub.py` — WS channel multiplexer (interface)
29. `src/backend/api/routes_*.py` — всі route файли (endpoints declared, no logic)

### Firmware
30. `src/firmware/platformio.ini`
31. `src/firmware/include/config.h` — pin definitions
32. `src/firmware/include/pins.h` — hardware mapping
33. `src/firmware/include/protocol.h` — JSON keys
34. `src/firmware/src/main.cpp` — FreeRTOS task setup (empty tasks)

### Root
35. `.claudeignore`
36. `.gitignore`
37. `scripts/setup.sh`
38. `scripts/dev.sh`

## Критерії Завершення
- [ ] `cd src/frontend && npm install` — без помилок
- [ ] `cd src/frontend && npx tsc --noEmit` — без помилок (types compile)
- [ ] `cd src/backend && pip install -r requirements.txt` — без помилок
- [ ] `cd src/backend && python -c "from db.models import *; print('OK')"` — OK
- [ ] `cd src/firmware && pio check` — без помилок (якщо PlatformIO встановлено)
- [ ] Всі shared types імпортуються і з frontend і з backend

## Залежності
Ніяких — це перша фаза.
