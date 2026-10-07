const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { loadBrowserConfig } = require('./browser-config.cjs');

function createShortcut(config) {
    if (process.platform === 'darwin') {
        const args = ['--user-data-dir=' + config.userDataDir, '--restore-last-session'];
        const child = spawn(config.browserPath, args, {
            cwd: config.projectRoot,
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
        console.log(`Браузер открыт с рабочим профилем: ${config.userDataDir}`);
        console.log('Выполните входы в мессенджеры, затем закройте окно браузера и запустите npm start.');
        return;
    }
    if (process.platform !== 'win32') {
        throw new Error('Автоматический запуск профиля поддерживается на Windows и macOS.');
    }
    // Восстанавливаем сохранённую сессию, не добавляя вкладки при каждом запуске.
    const args = `--user-data-dir="${config.userDataDir}" --restore-last-session`;
    // Пути передаются как данные, без вставки в код PowerShell.
    const command = [
        "$ErrorActionPreference = 'Stop'",
        "$shell = New-Object -ComObject WScript.Shell",
        "$shortcut = $shell.CreateShortcut($env:ORDER_SHORTCUT_PATH)",
        "$shortcut.TargetPath = $env:ORDER_BROWSER_PATH",
        "$shortcut.Arguments = $env:ORDER_BROWSER_ARGS",
        "$shortcut.WorkingDirectory = $env:ORDER_PROJECT_DIR",
        "$shortcut.Description = 'Orders browser - separate profile'",
        "$shortcut.IconLocation = $env:ORDER_BROWSER_PATH + ',0'",
        '$shortcut.Save()',
    ].join('; ');
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
        cwd: config.projectRoot,
        windowsHide: true,
        stdio: 'inherit',
        env: {
            ...process.env,
            ORDER_SHORTCUT_PATH: config.shortcutPath,
            ORDER_BROWSER_PATH: config.browserPath,
            ORDER_BROWSER_ARGS: args,
            ORDER_PROJECT_DIR: config.projectRoot,
        },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Не удалось создать ярлык. Проверьте сообщение выше.');
    console.log(`Ярлык создан: ${config.shortcutPath}`);
    console.log(`Рабочий профиль: ${config.userDataDir}`);
    console.log('Откройте ярлык и войдите в мессенджеры. Перед сбором закройте окна рабочего профиля.');
}

try {
    const mode = process.argv[2];
    if (mode !== 'shortcut') {
        throw new Error('Используйте create-browser-shortcut.cmd. Для сбора заказов выполните npm start.');
    }
    const config = loadBrowserConfig();
    createShortcut(config);
} catch (error) {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 1;
}
