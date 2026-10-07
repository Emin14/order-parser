#!/bin/sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите Node.js и повторите запуск."
  read -r _
  exit 1
fi
node scripts/browser-launcher.cjs shortcut
status=$?
echo
if [ "$status" -ne 0 ]; then
  echo "Не удалось открыть браузер."
fi
echo "Нажмите Enter для закрытия."
read -r _
exit "$status"
