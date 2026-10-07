const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadBrowserConfig } = require('../scripts/browser-config.cjs');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-config-'));
    t.after(() => {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.match(path.basename(root), /^orders-config-/);
        fs.rmSync(root, { recursive: true, force: true });
    });
    const projectRoot = path.join(root, 'Проект с пробелами');
    fs.mkdirSync(projectRoot);
    const browserPath = path.join(root, 'Browser with spaces.exe');
    fs.writeFileSync(browserPath, '');
    return { projectRoot, browserPath };
}

test('dotenv strips both quote styles; old settings cannot change the shared profile', (t) => {
    const { projectRoot, browserPath } = fixture(t);
    for (const quote of ["'", '"']) {
        fs.writeFileSync(path.join(projectRoot, '.env'), `# comment\nBROWSER_PATH=${quote}${browserPath}${quote}\nUSER_DATA_DIR='old-profile'\n`);
        const config = loadBrowserConfig(projectRoot);
        assert.equal(config.browserPath, browserPath);
        assert.equal(config.userDataDir, path.join(projectRoot, 'order-parser-profile'));
        assert.equal(path.dirname(config.shortcutPath), projectRoot);
        assert.equal(fs.existsSync(config.userDataDir), false);
    }
});

test('profile follows the project when it moves', (t) => {
    const { projectRoot, browserPath } = fixture(t);
    fs.writeFileSync(path.join(projectRoot, '.env'), `BROWSER_PATH='${browserPath}'`);
    const movedRoot = projectRoot + '-moved';
    fs.renameSync(projectRoot, movedRoot);
    const config = loadBrowserConfig(movedRoot);
    assert.equal(config.userDataDir, path.join(movedRoot, 'order-parser-profile'));
    assert.equal(path.dirname(config.shortcutPath), movedRoot);
});

test('missing .env, relative path, missing file and directory give useful errors', (t) => {
    const { projectRoot } = fixture(t);
    const envFile = path.join(projectRoot, '.env');
    assert.throws(() => loadBrowserConfig(projectRoot), /Нет файла .env/);
    fs.writeFileSync(envFile, 'BROWSER_PATH=browser.exe');
    assert.throws(() => loadBrowserConfig(projectRoot), /полный путь/);
    fs.writeFileSync(envFile, `BROWSER_PATH='${path.join(projectRoot, 'missing.exe')}'`);
    assert.throws(() => loadBrowserConfig(projectRoot), /не найден/);
    fs.writeFileSync(envFile, `BROWSER_PATH='${projectRoot}'`);
    assert.throws(() => loadBrowserConfig(projectRoot), /не найден/);
});
