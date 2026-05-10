# План реализации бота

Документ описывает архитектуру и порядок шагов. Кода здесь нет — только
решения, границы модулей, направления зависимостей и то, что собираемся
писать на каждом шаге.

## Принципы

1. **Discord — это деталь.** discord.js не должен просачиваться в логику
   опросов и сессий. Domain знает «вопрос», «ответ», «сессия» — и не
   знает про `Interaction`, `EmbedBuilder`, `ChatInputCommandInteraction`.
2. **JSON-хранилище — тоже деталь.** Завтра захотим Postgres — меняем
   только адаптер, не трогая core.
3. **Зависимости направлены внутрь:** `infrastructure → application →
   domain`. Domain ничего не импортирует из верхних слоёв. Application
   знает только о портах (интерфейсах), реализации портов живут в
   infrastructure.
4. **Никаких лишних абстракций.** Один интерфейс — одна реализация это
   нормально для MVP. Интерфейс появляется тогда, когда он нужен для
   тестируемости или для разделения слоёв, а не «на всякий случай».
5. **Модели данных пишем как plain TypeScript-типы**, без классов и
   декораторов. Бизнес-операции — функции, принимающие состояние и
   возвращающие новое состояние (immutable-стиль). Это удобно тестить
   и не плодит ООП-церемоний.

## Слои

```
┌────────────────────────────────────────────────────────────┐
│  src/infrastructure/                                       │
│    discord/        — discord.js client, handlers, рендер   │
│    storage/        — fs-адаптеры (polls, sessions, state)  │
│    config/         — чтение env                            │
└─────────────────┬──────────────────────────────────────────┘
                  │ depends on
                  ▼
┌────────────────────────────────────────────────────────────┐
│  src/application/                                          │
│    use-cases/      — startSurvey, submitAnswer, goBack,    │
│                      finishSurvey, restoreSession          │
│    ports/          — PollRepository, SessionRepository,    │
│                      ReportSink, MainMessageStore          │
└─────────────────┬──────────────────────────────────────────┘
                  │ depends on
                  ▼
┌────────────────────────────────────────────────────────────┐
│  src/domain/                                               │
│    poll/           — Poll, Question, Option (типы +        │
│                      pure-функции валидации/навигации)     │
│    session/        — Session, Answer + переходы            │
└────────────────────────────────────────────────────────────┘
```

**Правило импорта:**
- `domain/*` импортирует только из `domain/*`.
- `application/*` импортирует из `domain/*` и `application/ports`.
- `infrastructure/*` импортирует откуда угодно (но домен — только
  через порты application-слоя).
- Composition root (`src/index.ts`) собирает всё: создаёт адаптеры,
  инжектит их в use-case-фабрики, подключает к Discord-клиенту.

## Domain

### `domain/poll`
Чистые типы и функции вокруг определения опроса.

- Типы: `Poll`, `Question` (sum-тип: `FreeQuestion | SingleQuestion |
  MultiQuestion`), `Option`.
- Функции:
  - `validatePoll(raw): Poll` — runtime-валидация JSON-структуры
    (один путь — одна реализация без zod на старте; если позже захотим
    схему-как-данные, перейдём на zod).
  - `getQuestionByIndex(poll, idx): Question | null`
  - `isLastQuestion(poll, idx): boolean`

Никаких импортов из application/infrastructure. Никакого discord.js.
Никаких fs.

### `domain/session`
Состояние одного прохождения опроса одним пользователем.

- Типы:
  - `Session = { userId, pollId, answers: Record<questionId, Answer>,
    cursor: number, startedAt, updatedAt, status: 'active' | 'done' }`
  - `Answer` — sum-тип под три типа вопросов: `{ kind: 'free', text } |
    { kind: 'single', value } | { kind: 'multi', values }`
- Функции (все pure, immutable):
  - `startSession(userId, poll): Session`
  - `setAnswer(session, questionId, answer): Session`
  - `moveForward(session): Session`
  - `moveBack(session): Session`
  - `complete(session): Session`
  - `validateAnswer(question, answer): Result<Answer, string>` —
    проверка `min/max` для multi, непустоты для free и т.д.

## Application

### Порты (`application/ports`)
Контракты для всего, что выходит наружу из core. Реализации — в
infrastructure.

- `PollRepository`
  - `list(): Promise<Poll[]>` — все опросы для главного меню.
  - `getById(id): Promise<Poll | null>`
- `SessionRepository`
  - `findActive(userId, pollId): Promise<Session | null>`
  - `save(session): Promise<void>`
  - `delete(userId, pollId): Promise<void>`
- `ReportSink`
  - `send(report: SurveyReport): Promise<void>` — куда отправлять
    результат (адаптер пишет в Discord-канал; в тестах — в массив).
- `MainMessageStore`
  - `get(): Promise<{ channelId, messageId } | null>`
  - `set(ref): Promise<void>` — для восстановления persistent embed
    после рестарта.

### Use cases (`application/use-cases`)
Тонкие функции-оркестраторы. Каждый use case — это функция, принимающая
порты как зависимости и возвращающая исполнитель команды.

- `startSurvey({ userId, pollId })` — найти опрос, найти/создать
  сессию, вернуть «текущий вопрос» для рендера.
- `submitAnswer({ userId, pollId, questionId, answer })` — провалидировать
  ответ, обновить сессию, сохранить, вернуть «следующее состояние»:
  либо следующий вопрос, либо финальный отчёт.
- `goBack({ userId, pollId })` — сдвинуть курсор назад.
- `finishSurvey({ userId, pollId })` — собрать отчёт, отправить в
  ReportSink, удалить сессию.
- `restoreOrStart({ userId, pollId })` — для случая «эфемерка
  пропала, юзер снова открыл опрос».

Use case **не возвращает Discord-объекты**. Он возвращает доменные
структуры: «следующий вопрос Q», «опрос завершён, вот отчёт». Discord-
адаптер уже сам рендерит это в embed/components.

## Infrastructure

### `infrastructure/storage/json-poll-repository.ts`
Читает все `polls/*.json` при старте, парсит через `validatePoll`,
держит в памяти. Реализует `PollRepository`. Hot-reload не нужен в MVP.

### `infrastructure/storage/json-session-repository.ts`
- В памяти: `Map<\`${userId}:${pollId}\`, Session>`.
- На диск: `data/sessions.json` — пишем после каждого `save`/`delete`.
  Запись через temp-file + rename, чтобы не получить полусломанный
  json при крэше.
- При старте читает файл, восстанавливает Map.

### `infrastructure/storage/json-state-store.ts`
- `data/state.json`: id главного embed-сообщения и его канал.
  Реализует `MainMessageStore`.

### `infrastructure/discord/client.ts`
Создание `Client` с нужными intents, login. Регистрация
event-handlers — в одном месте.

### `infrastructure/discord/handlers/`
Тонкая прослойка между discord.js и use cases. Каждый handler:
1. Извлекает входные данные из `Interaction`.
2. Зовёт нужный use case.
3. Передаёт результат в renderer.
4. Отвечает / редактирует interaction.

Handlers:
- `select-poll.ts` — Select Menu главного embed (юзер выбрал опрос).
- `submit-answer-single.ts` / `submit-answer-multi.ts` — Select Menu
  внутри эфемерки.
- `submit-answer-modal.ts` — Modal-submit для free-вопросов.
- `nav-button.ts` — кнопки «Назад» / «Далее» / «Завершить» /
  «Открыть форму ответа».

### `infrastructure/discord/renderers/`
Чистые функции «доменное состояние → discord.js builders». Не делают
сетевых вызовов.

- `main-menu.ts`: `renderMainMenu(polls): { embeds, components }`.
- `question.ts`: `renderQuestion(poll, question, currentAnswer,
  cursor, total): { embeds, components }` — embed с текстом вопроса,
  ниже — Select Menu или кнопка «Ответить» (для free), плюс
  навигационные кнопки.
- `report.ts`: `renderReport(poll, session): { embeds }`.

### `infrastructure/discord/main-message.ts`
Логика persistent главного сообщения: при старте бота посмотреть в
`MainMessageStore`, если ссылка есть — попробовать отредактировать;
если сообщение удалено — отправить заново и сохранить.

### `infrastructure/config/env.ts`
Чтение `process.env`, валидация что все нужные переменные на месте,
fail-fast при старте.

## Composition root: `src/index.ts`
1. Прочитать env.
2. Создать `JsonPollRepository`, прочитать `polls/`.
3. Создать `JsonSessionRepository` (загрузить `data/sessions.json`).
4. Создать `JsonStateStore`.
5. Создать Discord-клиент, дождаться `ready`.
6. Создать `DiscordReportSink(client, REPORT_CHANNEL_ID)`.
7. Собрать use-case-фабрики, прокинув порты.
8. Подключить handlers к event-em-у клиента, прокинув use cases и
   рендереры.
9. Поднять persistent главное сообщение.

## Порядок шагов реализации

Каждый шаг — самодостаточный коммит, после которого `bun run typecheck`
зелёный.

1. **Domain: poll.** Типы `Poll`/`Question`/`Option`, `validatePoll`,
   `getQuestionByIndex`, `isLastQuestion`. Без зависимостей.
2. **Domain: session.** Типы `Session`/`Answer`, переходы (start, set,
   forward, back, complete), `validateAnswer`.
3. **Application: ports.** Интерфейсы `PollRepository`,
   `SessionRepository`, `ReportSink`, `MainMessageStore`.
4. **Application: use cases.** `startSurvey`, `submitAnswer`,
   `goBack`, `finishSurvey`, `restoreOrStart`. Каждый — функция,
   возвращающая доменный результат.
5. **Infra: config + storage.** `env.ts`, `JsonPollRepository`,
   `JsonSessionRepository`, `JsonStateStore`. Здесь появляется
   реальное чтение/запись fs.
6. **Infra: discord renderers.** `renderMainMenu`, `renderQuestion`,
   `renderReport`. Чистые функции, не зависят от клиента.
7. **Infra: discord client + main message.** Клиент, login,
   persistent главное сообщение.
8. **Infra: handlers.** Все четыре handler-а, регистрация на
   `interactionCreate`.
9. **Composition root.** Сборка всего в `src/index.ts`.
10. **Прогон сценариев вручную** на тестовом сервере: free / single /
    multi, навигация назад, восстановление после Dismiss, отчёт.

## Чего сознательно не делаем в MVP

- DI-контейнеры (Inversify и т.п.) — обходимся ручной сборкой.
- Юнит-тесты с моками всего — пишем тесты только для domain
  (validateAnswer, переходы сессии). Application и infra пока
  проверяем руками.
- Hot-reload опросов. Хочешь обновить — рестарт.
- Concurrency-locks по пользователю. Discord сам сериализует
  interactions от одного юзера достаточно, чтобы в MVP не словить
  гонки. Если поймаем — добавим простой lock per `userId:pollId`.
- zod / runtime-валидация по схеме. Пишем `validatePoll` руками — это
  ~30 строк и явно видно, что мы проверяем.
