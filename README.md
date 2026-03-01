# MD101

Веб-приложение для чата с OpenAI через backend-proxy со streaming-ответами.

## Возможности

- мультичат: список, создание, удаление, переключение
- автогенерация названия нового чата по первому сообщению
- глобальный `System prompt` (модалка)
- выбор модели и параметров (`reasoning effort`)
- стратегии памяти (пер-чат): переключатель в левой панели
  - `None` (по умолчанию): в OpenAI отправляется полная история
  - `Sliding Window` (реализовано): в OpenAI отправляются только последние `N` сообщений
- `Branching` (реализовано): в runtime используется полная история, а ветка создается через `Branch in new chat`
- ответвление чата: кнопка `Branch in new chat` создает полную копию диалога с заголовком `Ветка - ...`
  - в новом чате хранится checkpoint ветвления, разделитель `Ответвление от [название]` показывается в точке ветвления и ведет в исходный чат
- чат с потоковым ответом (`Send` / `Stop`)
- индикатор текущего контекста (`Context: current / max tokens`)
- модалка `Conversation info` с метриками:
  - `Current request`
  - `Conversation total`
  - `Growth by turns`
- инспектор справа:
  - `Request` / `Response` JSON
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

## Хранение данных

- история чатов и сообщений хранится в SQLite
- файл БД: `backend/data/md.sqlite`

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

- `gpt-3.5-turbo`
- `gpt-4.1-nano`
- `gpt-5-mini`
- `gpt-5.1`
- `gpt-5.2`

## API backend

- `GET /health`
- `GET /api/chats` - список чатов
- `POST /api/chats` - создать чат
- опциональные поля: `memoryStrategy`, `slidingWindowSize`
- `GET /api/chats/:id/messages` - история сообщений
- `PATCH /api/chats/:id` - обновить чат (`title`, `model`, `systemPrompt`, `memoryStrategy`, `slidingWindowSize`)
- `DELETE /api/chats/:id` - удалить чат
- `POST /api/chats/:id/branch` - создать новую ветку как копию чата
- `POST /api/chats/:id/stream` - отправить сообщение и получить streaming-ответ
  - опциональные поля: `memoryStrategy`, `slidingWindowSize`

Примечание по стратегиям памяти:
- по умолчанию используется `memoryStrategy=none` (полная история)
- сейчас поддерживаются `none`, `sliding_window`, `branching`
- `branching` в runtime эквивалентен полной истории (как `none`)
- допустимые значения `memoryStrategy`: `none`, `sliding_window`, `branching`

SSE-события stream endpoint:

- `delta`
- `debug_request`
- `debug_response_final`
- `done`
- `error`

## Управление вводом

- `Enter` - отправить сообщение
- `Shift + Enter` - новая строка

## Безопасность

- храните `OPENAI_API_KEY` только на backend
- не коммитьте `.env`
