# MD107

Веб-приложение для чата с OpenAI через backend-proxy со streaming-ответами.

## Что есть в UI

- мультичат (список чатов слева)
- создание и удаление чатов
- автогенерация названия нового чата по первому сообщению
- выбор активного чата с подгрузкой истории
- глобальный `System prompt` (модалка)
- `Model settings`:
  - выбор модели
  - `reasoning effort`
  - `temperature` (с ограничениями по модели)
- центральный чат с историей `You` / `Assistant`
- поле ввода + кнопка `Send` / `Stop`
- правая панель инспектора:
  - `Metrics` (latency, tokens, cost)
  - `Request` (тело запроса в OpenAI)
  - `Response` (финальный полезный ответ от OpenAI)
  - полноэкранный просмотр JSON

## Архитектура

- `frontend/`: React + TypeScript + Vite
- `backend/`: Fastify + TypeScript
- Frontend организован по слоям:
  - `src/domain`
  - `src/application`
  - `src/infrastructure`
  - `src/presentation`
  - `src/shared`
- Streaming между frontend и backend: SSE (`/api/chats/:id/stream`)
- Backend вызывает OpenAI `v1/responses`

## Хранение данных

- История чатов и сообщений хранится в SQLite.
- Файл БД: `backend/data/md.sqlite`
- После перезапуска backend данные сохраняются (в отличие от in-memory хранения).

## Переменные окружения

Создайте файл `.env` в корне:

```bash
cp .env.example .env
```

Минимальные переменные:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini
PORT=8787
```

Дополнительно:

- `HOST` (опционально, по умолчанию `0.0.0.0`)
- `VITE_API_BASE_URL` (опционально, для frontend; по умолчанию пусто, используется vite proxy)

## Быстрый старт

1. Установите зависимости:

```bash
cd backend && npm install
cd ../frontend && npm install
```

2. Запустите backend:

```bash
cd backend
npm run dev
```

3. В другом терминале запустите frontend:

```bash
cd frontend
npm run dev
```

4. Откройте `http://localhost:5173`

## Доступные модели (сейчас)

- `gpt-4.1-nano`
- `gpt-5-mini`
- `gpt-5.1`
- `gpt-5.2`

Важно:

- Для `gpt-5-mini` `temperature` не поддерживается.
- Для `gpt-5.1` и `gpt-5.2` `temperature` доступен только при `reasoningEffort=none`.

## API backend

- `GET /health`
- `GET /api/chats` - список чатов
- `POST /api/chats` - создать чат
- `GET /api/chats/:id/messages` - история сообщений чата
- `PATCH /api/chats/:id` - обновить чат (`title`, `model`, `systemPrompt`)
- `DELETE /api/chats/:id` - удалить чат
- `POST /api/chats/:id/stream` - отправить сообщение и получить streaming-ответ (SSE)

SSE-события на stream endpoint:

- `delta`
- `debug_request`
- `debug_response_final`
- `done`
- `error`

## Управление вводом

- `Enter` - отправить сообщение
- `Shift + Enter` - новая строка

## Безопасность

- Храните `OPENAI_API_KEY` только на backend.
- Не коммитьте `.env`.
