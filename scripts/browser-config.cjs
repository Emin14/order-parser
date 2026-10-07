const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

function loadBrowserConfig(projectRoot = path.resolve(__dirname, '..')) {
    projectRoot = path.resolve(projectRoot);
    const envPath = path.join(projectRoot, '.env');
    if (!fs.existsSync(envPath)) {
        throw new Error('Нет файла .env. Скопируйте .env.example в .env и укажите BROWSER_PATH.');
    }

    // Используем файл, а не унаследованные переменные старого запуска.
    const settings = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    const browserPath = settings.BROWSER_PATH;
    if (!browserPath || !path.isAbsolute(browserPath)) {
        throw new Error('Укажите в .env полный путь к файлу браузера в BROWSER_PATH.');
    }
    if (!fs.existsSync(browserPath) || !fs.statSync(browserPath).isFile()) {
        throw new Error(`Файл браузера не найден: ${browserPath}. Исправьте BROWSER_PATH в .env.`);
    }

    return {
        projectRoot,
        browserPath: path.normalize(browserPath),
        userDataDir: path.join(projectRoot, 'order-parser-profile'),
        shortcutPath: path.join(projectRoot, 'Браузер — Заказы.lnk'),
    };
}

module.exports = { loadBrowserConfig };
