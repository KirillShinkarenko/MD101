# MD101

Веб-приложение для чата с OpenAI через backend-proxy со streaming-ответами.

## Возможности

- мультичат: список, создание, удаление, переключение
- автогенерация названия нового чата по первому сообщению
- глобальный `System prompt` (модалка)
- профили персонализации: отдельная модалка `Profiles` (создание, удаление, редактирование, выбор активного)
  - активный профиль автоматически подмешивается в `systemPrompt` каждого запроса
- выбор модели и параметров (`reasoning effort`)
- выбор `Memory updater model` (модель, которая обновляет память перед основным ответом)
- глобальные переключатели памяти в `Model settings`:
  - `Short-term memory` - при выключении short-term не обновляется и не подмешивается в prompt
  - `Working memory` - при выключении working не обновляется, не подмешивается в prompt и недоступно ручное редактирование
  - `Long-term memory` - при выключении long-term не подмешивается в prompt и не генерирует новые кандидаты
- трёхслойная память:
  - `Short-term` (пер-чат): накопительное саммари диалога (`rolling summary`)
  - `Working` (пер-чат): `goal`, `constraints`, `status`, `next_steps` с ручным редактированием
  - `Long-term` (глобальная): `profile`, `preferences`, `decisions`, `knowledge` с ручным редактированием
- `Pending long-term candidates`: автопредложения на запись в long-term с `Approve/Reject`
- ответвление чата: кнопка `Branch in new chat` создает полную копию диалога с заголовком `Ветка - ...`
  - в новом чате хранится checkpoint ветвления, разделитель `Ответвление от [название]` показывается в точке ветвления и ведет в исходный чат
- чат с потоковым ответом (`Send` / `Stop`)
- индикатор текущего контекста (`Context: current / max tokens`)
- модалка `Conversation info` с метриками:
  - `Current request`
  - `Conversation total`
  - `Growth by turns`
- инспектор справа:
  - вкладки `Request` / `Response` / `Memory`
  - просмотр и редактирование memory snapshot
  - `Effective memory block` (какой блок памяти реально был подмешан в `systemPrompt`)
  - полноэкранный просмотр JSON

## Архитектура

- `frontend/`: React + TypeScript + Vite
- `backend/`: Fastify + TypeScript
- слои фронтенда:
  - `src/domain`
  - `src/application`
  - `src/infrastructure`
  - `src/presentation`
  - `src/shared`
- поток между frontend и backend: SSE (`POST /api/chats/:id/stream`)
- backend обращается к OpenAI `v1/responses`
- memory pipeline на backend:
  - отдельный вызов memory-updater модели обновляет только включенные слои (`short-term`, `working`) и формирует кандидаты в `long-term` только если long-term включен
  - из snapshot строится `memory block`
  - `memory block` добавляется в `systemPrompt` основного запроса только для включенных слоев памяти

## Хранение данных

- история чатов, сообщений и слоёв памяти хранится в SQLite
- файл БД: `backend/data/md.sqlite`
- основные таблицы памяти:
  - `chat_short_memory`
  - `chat_working_memory`
  - `global_long_term_memory`
  - `long_term_candidates`
- таблицы профилей:
  - `user_profiles`
  - `profile_settings`
- таблица настроек памяти:
  - `memory_settings`

## Переменные окружения

Скопируйте шаблон:

```bash
cp .env.example .env
```

Минимально:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini
PORT=8787
```

Опционально:

- `HOST` (по умолчанию `0.0.0.0`)
- `VITE_API_BASE_URL` (для frontend; по умолчанию используется Vite proxy)

## Быстрый старт

1. Установить зависимости:

```bash
cd backend && npm install
cd ../frontend && npm install
```

2. Запустить backend:

```bash
cd backend
npm run dev
```

3. В другом терминале запустить frontend:

```bash
cd frontend
npm run dev
```

4. Открыть `http://localhost:5173`

## Поддерживаемые модели

- `gpt-3.5-turbo` (`reasoningEffort` не поддерживается)
- `gpt-4.1-nano` (`reasoningEffort` не поддерживается)
- `gpt-5-mini` (`minimal`, `low`, `medium`, `high`)
- `gpt-5.1` (`none`, `low`, `medium`, `high`)
- `gpt-5.2` (`none`, `low`, `medium`, `high`, `xhigh`)

По умолчанию:

- основная модель: `OPENAI_MODEL` из `.env` (fallback: `gpt-5-mini`)
- `Memory updater model`: `gpt-4.1-nano` (если не передан `memoryModel` в stream-запросе)

## API backend

- `GET /health`
- `GET /api/chats` - список чатов
- `GET /api/profiles` - список профилей и текущий активный профиль
- `POST /api/profiles` - создать профиль (`name`)
- `PATCH /api/profiles/:id` - обновить профиль (`name`, `style`, `outputFormat`, `constraints`, `notes`)
- `DELETE /api/profiles/:id` - удалить профиль
- `PUT /api/profiles/active` - выбрать активный профиль (`profileId` или `null`)
- `GET /api/memory/settings` - получить глобальные настройки памяти (`shortTermEnabled`, `workingEnabled`, `longTermEnabled`, `updatedAt`)
- `PATCH /api/memory/settings` - обновить глобальные настройки памяти (partial: `shortTermEnabled?`, `workingEnabled?`, `longTermEnabled?`)
- `POST /api/chats` - создать чат
  - опциональные поля: `title`, `model`, `systemPrompt`
- `GET /api/chats/:id/messages` - история сообщений
- `GET /api/chats/:id/memory` - получить snapshot памяти (`shortTerm`, `working`, `longTerm`, `pendingCandidates`)
- `PATCH /api/chats/:id` - обновить чат (`title`, `model`, `systemPrompt`)
- `PATCH /api/chats/:id/memory/working` - вручную обновить `goal`, `constraints`, `status`, `nextSteps`
  - при `workingEnabled=false` возвращает `409` (`working memory is disabled`)
- `PATCH /api/memory/long-term` - вручную обновить `profile`, `preferences`, `decisions`, `knowledge`
- `POST /api/memory/candidates/:id/approve` - принять кандидата в long-term
- `POST /api/memory/candidates/:id/reject` - отклонить кандидата
- `DELETE /api/chats/:id` - удалить чат
- `POST /api/chats/:id/branch` - создать новую ветку как копию чата
- `POST /api/chats/:id/stream` - отправить сообщение и получить streaming-ответ
  - обязательное поле: `userPrompt`
  - опциональные поля: `model`, `systemPrompt`, `reasoningEffort`, `memoryModel`

SSE-события stream endpoint:

- `delta`
- `debug_memory`
- `debug_request`
- `debug_response_final`
- `done`
- `error`

`debug_response_final` содержит usage (`input/output/total tokens`) и оценку стоимости (`input/output/total cost usd`) для поддерживаемых моделей.

## Управление вводом

- `Enter` - отправить сообщение
- `Shift + Enter` - новая строка

## Production

Backend:

```bash
cd backend
npm run build
npm run start
```

Frontend:

```bash
cd frontend
npm run build
npm run preview
```

## Безопасность

- храните `OPENAI_API_KEY` только на backend
- не коммитьте `.env`
