# MD102

Веб-приложение для общения с OpenAI через backend-proxy со streaming-ответами.

## Что есть в UI

- `System Prompt`
- чат с историей сообщений (`You` / `Assistant`)
- поле `Message` под чатом
- одна action-кнопка `Send` / `Stop`
- `Clear Session` в правом верхнем углу чата
- блок `Raw` с:
  - `Backend -> OpenAI body`
  - `OpenAI -> Backend final useful body`

## Архитектура

- `frontend/`: React + TypeScript + Vite
- `backend/`: Fastify + TypeScript
- Streaming через SSE: `POST /api/chat/stream`
- Сброс серверной сессии: `POST /api/chat/session/reset`
- Backend uses OpenAI `v1/responses` (streaming)

## Контекст диалога

- Frontend отправляет постоянный `sessionId` для вкладки.
- Backend хранит историю сообщений по `sessionId`.
- В каждый запрос к Responses API backend отправляет весь предыдущий диалог целиком.
- При смене `System Prompt` цепочка контекста для этой сессии сбрасывается.
- `Clear Session` очищает чат в UI и сбрасывает сессию на backend.

## Хранение сессий

- История хранится в памяти backend (`Map`), не в БД.
- После перезапуска backend история очищается.
- Если количество сессий становится слишком большим, старые сессии удаляются автоматически (ограничение по количеству в коде).

## Быстрый старт

1. Создайте `.env`:

```bash
cp .env.example .env
```

2. Заполните `.env`:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini
PORT=8787
```

3. Установите зависимости:

```bash
cd backend && npm install
cd ../frontend && npm install
```

4. Запустите backend:

```bash
cd backend
npm run dev
```

5. В другом терминале запустите frontend:

```bash
cd frontend
npm run dev
```

6. Откройте:

- `http://localhost:5173`

## Управление вводом

- `Enter` отправляет сообщение
- `Shift + Enter` добавляет перенос строки

## Безопасность

- Храните `OPENAI_API_KEY` только на backend.
- Не коммитьте `.env`.
