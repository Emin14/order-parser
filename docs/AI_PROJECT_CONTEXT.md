# Контекст проекта для ИИ

> Этот файл — рабочая память проекта Order Parser. Перед изменением логики сначала прочитайте раздел «Текущая истина», затем соответствующую историю решений. История коммитов не заменяет проверку исходного кода: если код и старое описание расходятся, актуальным считается код и конфигурация.

## Текущая истина (проверено 2026-10-09)

### Архитектура

- `src/parsers/vk.ts`, `src/parsers/whatsapp.ts`, `src/parsers/telegram.ts` собирают сообщения из браузера.
- `src/utils/date.ts` решает, относится ли чат/сообщение к текущей смене.
- `src/utils/word_exporter.ts` нормализует заголовки, разделяет блоки и группирует заказы.
- `cafes_config.json` — источник настроек платформ и чатов.
- `docs/chat-flags.html` — визуальный справочник флагов; после изменения `cafes_config.json` его нужно пересобрать.

### Правила, которые нельзя случайно отменять

1. **Ночная смена.** С 00:00 до 05:59 смена продолжается от предыдущего дня (`getShiftMode`). Для VK относительные даты (`· 34м`, `· 2ч`) должны проходить через те же правила, что и полные даты. Старые сообщения не расширяются автоматически.
2. **VK-граница списка.** VK собирается снизу вверх до первого чата вне текущей смены. Если дата распознана ошибочно, будет обработано 0 чатов — сначала проверяйте `parseVkDate` и `isMessageActual`.
3. **Филиалы.** Филиал определяется только по `branches[].name` и `branches[].aliases`. Любое новое написание из сообщения нужно добавлять в конфиг соответствующего мессенджера.
4. **Общий чат.** `shared_chat: true` включает осторожное определение заголовка и разделение по настроенным веткам; неизвестный заголовок не следует автоматически объявлять филиалом.
5. **Бар и кухня.** Старый формат `Заказ бар:`/`Заказ кухня:` поддерживается глобально. Флаг `split_bar_kitchen: true` включает для конкретного чата разделение также по отдельным строкам `бар`, `кухня`, `на бар`, `на кухню` (с двоеточием или без него).
6. **Группировка.** `merge_same_spot` по умолчанию включён. Явное `false` запрещает объединение заказов одной точки. Это не флаг определения филиала.
7. **Собираемость сообщения.** Для утренних/дневных/вечерних границ учитывайте `isForTomorrow`, `isMessageActual`, день недели и воскресные/понедельничные исключения.

### Последние изменения, ещё не оформленные отдельным коммитом

- В `cafes_config.json` добавлены алиасы филиала «Грузинка» для VK-чата «Эрфольг/кривченков заказы овощи».
- Для Telegram-чата «Овощи Скетч и Верде» включён `split_bar_kitchen: true`, удалён `merge_same_spot: false`; добавлены ветки «Скетч» и «Верде».
- В `src/utils/date.ts` исправлено распознавание относительных VK-дат после полуночи; добавлен `tests/vk-midnight.test.cjs`.
- Эти изменения видны в рабочем дереве и должны быть учтены при следующем коммите.

## Как принимать решения дальше

- Сначала воспроизвести проблему на минимальном тексте/дате и определить этап отказа: сбор чата, фильтр даты, разбор заголовка или группировка.
- Настройки конкретного чата добавлять в `cafes_config.json`, а универсальные правила — в соответствующий parser/util.
- Не использовать общий алиас вроде `бар` как филиал: он может совпасть с частью обычного текста. Для филиалов использовать точные словоформы и контекст.
- Для каждого исправления добавлять регрессионный тест на исходный сбой, особенно для полуночи, относительных дат и вариантов написания филиалов.
- После изменения конфига пересобирать `docs/chat-flags.html` и проверять, что новый флаг виден в таблице.
- Не считать успешным запуском отсутствие исключения: проверять число найденных чатов, причины `actual=false` и итоговое число заказов.
- Перед удалением существующего поведения искать `revert` и последующие `fix` в истории: они часто объясняют, почему простое решение уже было отменено.

## Полная история коммитов

Формат: `дата — commit — автор — сообщение`; список файлов показывает область изменения. Если нужно понять мотивацию глубже, открывайте diff указанного коммита.

### 2026-10-08 · `d47ff2f` · test: avoid sandbox rename in profile portability check

- Автор: Emin14
- Цель по сообщению коммита: test: avoid sandbox rename in profile portability check
- Изменённые файлы: `tests/browser-config.test.cjs`
- Статистика: 1 file changed, 3 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show d47ff2f` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-08 · `b30b7f5` · fix: preserve sender order and today markers

- Автор: Emin14
- Цель по сообщению коммита: fix: preserve sender order and today markers
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 24 insertions(+), 25 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show b30b7f5` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-08 · `fb5a6a0` · config: add configured chat branches

- Автор: Emin14
- Цель по сообщению коммита: config: add configured chat branches
- Изменённые файлы: `cafes_config.json`
- Статистика: 1 file changed, 49 insertions(+), 3 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show fb5a6a0` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-08 · `aa6a924` · fix: deduplicate VK messages by stable item key

- Автор: Emin14
- Цель по сообщению коммита: fix: deduplicate VK messages by stable item key
- Изменённые файлы: `src/parsers/vk.ts`
- Статистика: 1 file changed, 13 insertions(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show aa6a924` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-08 · `5c970fb` · Wait up to one minute for VK login

- Автор: Эмин
- Цель по сообщению коммита: Wait up to one minute for VK login
- Изменённые файлы: `src/parsers/vk.ts`
- Статистика: 1 file changed, 12 insertions(+)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 5c970fb` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-08 · `4b125aa` · Add macOS browser launcher and shared npm command

- Автор: Эмин
- Цель по сообщению коммита: Add macOS browser launcher and shared npm command
- Изменённые файлы: `README.md`, `create-browser-shortcut.command`, `package.json`, `scripts/browser-launcher.cjs`
- Статистика: 4 files changed, 43 insertions(+), 6 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 4b125aa` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-07 · `0e4340f` · fix: make browser profiles portable and preserve chat order

- Автор: Emin14
- Цель по сообщению коммита: fix: make browser profiles portable and preserve chat order
- Изменённые файлы: `.env.example`, `.gitignore`, `README.md`, `create-browser-shortcut.cmd`, `package-lock.json`, `package.json`, `scripts/browser-config.cjs`, `scripts/browser-launcher.cjs`, `src/index.ts`, `src/parsers/vk.ts`, `src/parsers/whatsapp.ts`, `src/utils/date.ts`, `src/utils/word_exporter.ts`, `tests/browser-config.test.cjs`
- Статистика: 14 files changed, 521 insertions(+), 37 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 0e4340f` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-03 · `b38810f` · fix: make whatsapp scroll stop extremely resilient by reading exact dates from message metadata instead of relying on visual date banners

- Автор: Emin 14
- Цель по сообщению коммита: fix: make whatsapp scroll stop extremely resilient by reading exact dates from message metadata instead of relying on visual date banners
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 11 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show b38810f` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-03 · `6b26ace` · perf: optimize telegram scroll to break immediately upon reaching boundary instead of forcing 3 iterations

- Автор: Emin 14
- Цель по сообщению коммита: perf: optimize telegram scroll to break immediately upon reaching boundary instead of forcing 3 iterations
- Изменённые файлы: `src/parsers/telegram.ts`
- Статистика: 1 file changed, 1 insertion(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 6b26ace` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-03 · `c3e5a5f` · chore: remove spy logs and apply telegram scroll optimization

- Автор: Emin 14
- Цель по сообщению коммита: chore: remove spy logs and apply telegram scroll optimization
- Изменённые файлы: `orders.json`
- Статистика: 1 file changed, 348 insertions(+), 246 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show c3e5a5f` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `2f7f839` · revert: remove <br> replacement logic as requested by the user, keep only the banner fix

- Автор: Emin 14
- Цель по сообщению коммита: revert: remove <br> replacement logic as requested by the user, keep only the banner fix
- Изменённые файлы: `src/parsers/telegram.ts`, `src/parsers/whatsapp.ts`
- Статистика: 2 files changed, 1 insertion(+), 6 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 2f7f839` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `9f4d5f0` · fix: ignore non-date service messages (e.g. user added) in Telegram parsing which were falsely treated as date banners and causing orders to be skipped

- Автор: Emin 14
- Цель по сообщению коммита: fix: ignore non-date service messages (e.g. user added) in Telegram parsing which were falsely treated as date banners and causing orders to be skipped
- Изменённые файлы: `src/parsers/telegram.ts`
- Статистика: 1 file changed, 15 insertions(+), 7 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 9f4d5f0` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `4f29572` · fix: add wait retry to whatsapp scroll to prevent intermittent early aborts during loading spinners

- Автор: Emin 14
- Цель по сообщению коммита: fix: add wait retry to whatsapp scroll to prevent intermittent early aborts during loading spinners
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 15 insertions(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 4f29572` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `4d34a47` · fix: replace <br> with newlines before extracting textContent to prevent dropped product lines in Telegram and WhatsApp

- Автор: Emin 14
- Цель по сообщению коммита: fix: replace <br> with newlines before extracting textContent to prevent dropped product lines in Telegram and WhatsApp
- Изменённые файлы: `src/parsers/telegram.ts`, `src/parsers/whatsapp.ts`
- Статистика: 2 files changed, 7 insertions(+)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 4d34a47` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `89d721c` · refactor: simplify early exit to universal logic and remove debug file again

- Автор: Emin 14
- Цель по сообщению коммита: refactor: simplify early exit to universal logic and remove debug file again
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 4 insertions(+), 30 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 89d721c` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `7a77190` · fix: smart early exit for whatsapp scroll to prevent over-scrolling, and temporarily restore debug file

- Автор: Emin 14
- Цель по сообщению коммита: fix: smart early exit for whatsapp scroll to prevent over-scrolling, and temporarily restore debug file
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 30 insertions(+), 4 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 7a77190` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `96bf2e8` · refactor: optimize whatsapp scroll loop with early exit and remove debug artifacts

- Автор: Emin 14
- Цель по сообщению коммита: refactor: optimize whatsapp scroll loop with early exit and remove debug artifacts
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 10 insertions(+), 6 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 96bf2e8` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `a08fa0e` · fix: extract explicit date category from prePlainText to bypass buggy WhatsApp DOM banner ordering

- Автор: Emin 14
- Цель по сообщению коммита: fix: extract explicit date category from prePlainText to bypass buggy WhatsApp DOM banner ordering
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 24 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show a08fa0e` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `0d9bb16` · fix: add textContent fallback for whatsapp message extraction and enable debug logging

- Автор: Emin 14
- Цель по сообщению коммита: fix: add textContent fallback for whatsapp message extraction and enable debug logging
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 9 insertions(+), 3 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 0d9bb16` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `34172cb` · fix: use native keyboard PageUp for whatsapp virtual list scroll

- Автор: Emin 14
- Цель по сообщению коммита: fix: use native keyboard PageUp for whatsapp virtual list scroll
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 5 insertions(+), 25 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 34172cb` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `295c8aa` · fix: aggressively target whatsapp scroll container by traversing up from message row and modifying scrollTop

- Автор: Emin 14
- Цель по сообщению коммита: fix: aggressively target whatsapp scroll container by traversing up from message row and modifying scrollTop
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 16 insertions(+), 4 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 295c8aa` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `017ab20` · fix: use scrollIntoView on first message instead of scrollBy to reliably trigger whatsapp virtual list

- Автор: Emin 14
- Цель по сообщению коммита: fix: use scrollIntoView on first message instead of scrollBy to reliably trigger whatsapp virtual list
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 5 insertions(+), 3 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 017ab20` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `e87d817` · fix: use robust DOM scrolling instead of mouse wheel for whatsapp virtual list

- Автор: Emin 14
- Цель по сообщению коммита: fix: use robust DOM scrolling instead of mouse wheel for whatsapp virtual list
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 7 insertions(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show e87d817` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `592c387` · fix: correctly assign date categories to messages loaded before the first sticky banner in whatsapp virtual lists

- Автор: Emin 14
- Цель по сообщению коммита: fix: correctly assign date categories to messages loaded before the first sticky banner in whatsapp virtual lists
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 9 insertions(+), 6 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 592c387` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `ad4a978` · feat: smart scroll collection for whatsapp virtual lists to fix missing older messages

- Автор: Emin 14
- Цель по сообщению коммита: feat: smart scroll collection for whatsapp virtual lists to fix missing older messages
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 151 insertions(+), 108 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show ad4a978` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `d8f398c` · revert: remove whatsapp scrolling that broke virtualized list

- Автор: Emin 14
- Цель по сообщению коммита: revert: remove whatsapp scrolling that broke virtualized list
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 10 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show d8f398c` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `596197f` · fix: scroll up in WhatsApp chat history to ensure older messages from today/yesterday are loaded into the DOM

- Автор: Emin 14
- Цель по сообщению коммита: fix: scroll up in WhatsApp chat history to ensure older messages from today/yesterday are loaded into the DOM
- Изменённые файлы: `src/parsers/whatsapp.ts`
- Статистика: 1 file changed, 10 insertions(+)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 596197f` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `2cee1ae` · fix: anchor greeting and intro word stripping strictly to the start of messages so they aren't deleted from the middle of the text body

- Автор: Emin 14
- Цель по сообщению коммита: fix: anchor greeting and intro word stripping strictly to the start of messages so they aren't deleted from the middle of the text body
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 12 insertions(+), 10 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 2cee1ae` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `60cbda9` · fix: remove dash from punctuation stripping per user request

- Автор: Emin 14
- Цель по сообщению коммита: fix: remove dash from punctuation stripping per user request
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 3 insertions(+), 3 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 60cbda9` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `b3ddde0` · fix: add semicolons and dashes to punctuation stripped from greetings and introductory phrases

- Автор: Emin 14
- Цель по сообщению коммита: fix: add semicolons and dashes to punctuation stripped from greetings and introductory phrases
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 3 insertions(+), 3 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show b3ddde0` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-02 · `f9de4af` · fix: wait for chat title to update before extracting messages in VK and WhatsApp to prevent race conditions

- Автор: Emin 14
- Цель по сообщению коммита: fix: wait for chat title to update before extracting messages in VK and WhatsApp to prevent race conditions
- Изменённые файлы: `src/parsers/vk.ts`, `src/parsers/whatsapp.ts`
- Статистика: 2 files changed, 25 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show f9de4af` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-01 · `52386e7` · chore: reset FROM_TIME back to default empty string

- Автор: Emin 14
- Цель по сообщению коммита: chore: reset FROM_TIME back to default empty string
- Изменённые файлы: `src/index.ts`
- Статистика: 1 file changed, 1 insertion(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 52386e7` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-01 · `f5f4f3a` · feat: append fromTime to output word document filename if specified (e.g. 'Заказ на 01.10.2026 с 00.20')

- Автор: Emin 14
- Цель по сообщению коммита: feat: append fromTime to output word document filename if specified (e.g. 'Заказ на 01.10.2026 с 00.20')
- Изменённые файлы: `src/index.ts`
- Статистика: 1 file changed, 9 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show f5f4f3a` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-01 · `77baa69` · fix: add standalone 'заказ' and 'заявка' to intro stripping to trigger header fallback correctly

- Автор: Emin 14
- Цель по сообщению коммита: fix: add standalone 'заказ' and 'заявка' to intro stripping to trigger header fallback correctly
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 2 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 77baa69` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-01 · `e5cc2d5` · fix: call closeActiveVkChat before looking for VK folders to prevent open chat covering tabs

- Автор: Emin 14
- Цель по сообщению коммита: fix: call closeActiveVkChat before looking for VK folders to prevent open chat covering tabs
- Изменённые файлы: `src/parsers/vk.ts`
- Статистика: 1 file changed, 13 insertions(+), 4 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show e5cc2d5` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-01 · `a5b9f2e` · fix: revert to exact VK folder selector and use state: attached to fix off-screen visibility timeouts

- Автор: Emin 14
- Цель по сообщению коммита: fix: revert to exact VK folder selector and use state: attached to fix off-screen visibility timeouts
- Изменённые файлы: `src/parsers/vk.ts`
- Статистика: 1 file changed, 6 insertions(+), 11 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show a5b9f2e` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-01 · `073d1d2` · fix: make VK 'Заказы' folder locator much more robust to UI changes

- Автор: Emin 14
- Цель по сообщению коммита: fix: make VK 'Заказы' folder locator much more robust to UI changes
- Изменённые файлы: `src/parsers/vk.ts`
- Статистика: 1 file changed, 14 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 073d1d2` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-10-01 · `f0fea73` · fix: wait for topic title to appear when switching telegram forum topics to prevent reading stale DOM

- Автор: Emin 14
- Цель по сообщению коммита: fix: wait for topic title to appear when switching telegram forum topics to prevent reading stale DOM
- Изменённые файлы: `src/parsers/telegram.ts`
- Статистика: 1 file changed, 10 insertions(+)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show f0fea73` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `0d7e2d0` · fix: correctly strip year in tomorrow date pattern (e.g. 1.10.26)

- Автор: Emin 14
- Цель по сообщению коммита: fix: correctly strip year in tomorrow date pattern (e.g. 1.10.26)
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 2 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 0d7e2d0` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `69519ba` · fix: correctly strip chained intro phrases (e.g. 'примите заказ пожалуйста на сегодня') and standalone 'Доброе'

- Автор: Emin 14
- Цель по сообщению коммита: fix: correctly strip chained intro phrases (e.g. 'примите заказ пожалуйста на сегодня') and standalone 'Доброе'
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 10 insertions(+), 4 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 69519ba` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `7e543bb` · fix: fallback to chat name if the remaining first line is a product (prevents 'Романо 15шт' from becoming a header)

- Автор: Emin 14
- Цель по сообщению коммита: fix: fallback to chat name if the remaining first line is a product (prevents 'Романо 15шт' from becoming a header)
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 12 insertions(+), 3 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 7e543bb` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `3d5fee2` · fix: include 'закупка' in stripTomorrowPhrase regex

- Автор: Emin 14
- Цель по сообщению коммита: fix: include 'закупка' in stripTomorrowPhrase regex
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 1 insertion(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 3d5fee2` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `4a53522` · feat: strip intro phrases like 'примите заказ' and 'прошу принять заявку' from headers

- Автор: Emin 14
- Цель по сообщению коммита: feat: strip intro phrases like 'примите заказ' and 'прошу принять заявку' from headers
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 8 insertions(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 4a53522` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `dc42cc2` · feat: implicitly strip target date (e.g. 1.10) in 'на завтра' phrases for orders placed after 15:00

- Автор: Emin 14
- Цель по сообщению коммита: feat: implicitly strip target date (e.g. 1.10) in 'на завтра' phrases for orders placed after 15:00
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 20 insertions(+), 3 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show dc42cc2` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `286f6bc` · fix: make 'ИП Лялин' aliases safer to prevent splitting on item weights like '100 гр'

- Автор: Emin 14
- Цель по сообщению коммита: fix: make 'ИП Лялин' aliases safer to prevent splitting on item weights like '100 гр'
- Изменённые файлы: `cafes_config.json`
- Статистика: 1 file changed, 4 insertions(+), 2 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 286f6bc` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `1b3efad` · fix: remove Telegram single-letter avatar artifacts (e.g. П\nПремьер) from chat names

- Автор: Emin 14
- Цель по сообщению коммита: fix: remove Telegram single-letter avatar artifacts (e.g. П\nПремьер) from chat names
- Изменённые файлы: `src/parsers/telegram.ts`, `src/utils/word_exporter.ts`
- Статистика: 2 files changed, 5 insertions(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 1b3efad` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `d3df3ad` · fix: strip trailing colons from greetings

- Автор: Emin 14
- Цель по сообщению коммита: fix: strip trailing colons from greetings
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 1 insertion(+), 1 deletion(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show d3df3ad` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `af9f6cf` · feat: implicitly strip redundant 'на завтра' phrases for orders placed after 15:00

- Автор: Emin 14
- Цель по сообщению коммита: feat: implicitly strip redundant 'на завтра' phrases for orders placed after 15:00
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 21 insertions(+)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show af9f6cf` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `1d616d4` · fix: correctly handle 'dobor' timeline by mapping times relative to currentTime

- Автор: Emin 14
- Цель по сообщению коммита: fix: correctly handle 'dobor' timeline by mapping times relative to currentTime
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 11 insertions(+), 7 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 1d616d4` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `ccaa539` · fix: correctly handle 'dobor' timeline wrapping by mapping HH:MM to absolute minutes relative to shift start (11:00)

- Автор: Emin 14
- Цель по сообщению коммита: fix: correctly handle 'dobor' timeline wrapping by mapping HH:MM to absolute minutes relative to shift start (11:00)
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 16 insertions(+), 6 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show ccaa539` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `fdbcffa` · feat: add 'dobor' mode to filter orders by time (FROM_TIME constant and --from CLI arg)

- Автор: Emin 14
- Цель по сообщению коммита: feat: add 'dobor' mode to filter orders by time (FROM_TIME constant and --from CLI arg)
- Изменённые файлы: `src/index.ts`, `src/utils/word_exporter.ts`
- Статистика: 2 files changed, 37 insertions(+), 4 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show fdbcffa` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `02a8a3d` · data: update mock and output order data, remove stale docx artifact

- Автор: Emin 14
- Цель по сообщению коммита: data: update mock and output order data, remove stale docx artifact
- Изменённые файлы: `mock_orders.json`, `orders.json`, `"\320\227\320\260\320\272\320\260\320\267 \320\275\320\260 27.09.2026.docx"`
- Статистика: 3 files changed, 273 insertions(+), 749 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 02a8a3d` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `22ba4e3` · feat: update date boundaries (11:00 cutoff, 09:00 conditional), cafes_config additions (display_name, merge_by_sender, use_branch_name, prefix_brand)

- Автор: Emin 14
- Цель по сообщению коммита: feat: update date boundaries (11:00 cutoff, 09:00 conditional), cafes_config additions (display_name, merge_by_sender, use_branch_name, prefix_brand)
- Изменённые файлы: `cafes_config.json`, `src/index.ts`, `src/parsers/whatsapp.ts`, `src/utils/date.ts`
- Статистика: 4 files changed, 330 insertions(+), 61 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 22ba4e3` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `d5da9a3` · fix: add retry logic for VK 'Заказы' tab click — verify tab is active before parsing

- Автор: Emin 14
- Цель по сообщению коммита: fix: add retry logic for VK 'Заказы' tab click — verify tab is active before parsing
- Изменённые файлы: `src/parsers/vk.ts`
- Статистика: 1 file changed, 61 insertions(+), 28 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show d5da9a3` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `da1587d` · fix: handle RichMessage/InstantView with p/li lists in Telegram — preserve newlines in extracted text

- Автор: Emin 14
- Цель по сообщению коммита: fix: handle RichMessage/InstantView with p/li lists in Telegram — preserve newlines in extracted text
- Изменённые файлы: `src/parsers/telegram.ts`
- Статистика: 1 file changed, 172 insertions(+), 84 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show da1587d` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-30 · `408dc8b` · feat: add replyTo-based addition merging, prefix_brand strict split, polite words stripping from headers

- Автор: Emin 14
- Цель по сообщению коммита: feat: add replyTo-based addition merging, prefix_brand strict split, polite words stripping from headers
- Изменённые файлы: `src/utils/word_exporter.ts`
- Статистика: 1 file changed, 287 insertions(+), 123 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 408dc8b` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-27 · `c1800cd` · data: update orders.json, add mock orders dataset and sample docx export

- Автор: Emin 14
- Цель по сообщению коммита: data: update orders.json, add mock orders dataset and sample docx export
- Изменённые файлы: `mock_orders.json`, `orders.json`, `"\320\227\320\260\320\272\320\260\320\267 \320\275\320\260 27.09.2026.docx"`
- Статистика: 3 files changed, 700 insertions(+), 558 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show c1800cd` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-27 · `242e492` · feat: implement Word export module, rules, and cafes configuration

- Автор: Emin 14
- Цель по сообщению коммита: feat: implement Word export module, rules, and cafes configuration
- Изменённые файлы: `cafes_config.json`, `export_rules.md`, `package-lock.json`, `package.json`, `src/index.ts`, `src/utils/word_exporter.ts`
- Статистика: 6 files changed, 843 insertions(+), 20 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 242e492` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-25 · `3d4cc27` · Update VK parser, enable all messengers in index, add .env.example

- Автор: Emin 14
- Цель по сообщению коммита: Update VK parser, enable all messengers in index, add .env.example
- Изменённые файлы: `.env.example`, `orders.json`, `src/index.ts`, `src/parsers/vk.ts`
- Статистика: 4 files changed, 887 insertions(+), 184 deletions(-)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 3d4cc27` и проверить, не появился ли позднее `revert` или исправляющий коммит.

### 2026-09-25 · `11400bd` · Initial commit: order parser project

- Автор: Emin 14
- Цель по сообщению коммита: Initial commit: order parser project
- Изменённые файлы: `.gitignore`, `orders.json`, `package-lock.json`, `package.json`, `scratch_debug.ts`, `src/index.ts`, `src/parsers/telegram.ts`, `src/parsers/vk.ts`, `src/parsers/whatsapp.ts`, `src/types.ts`, `src/utils/date.ts`, `tsconfig.json`
- Статистика: 12 files changed, 3074 insertions(+)
- Проверка для ИИ: перед повторением этого решения сравнить текущий код с `git show 11400bd` и проверить, не появился ли позднее `revert` или исправляющий коммит.

