/**
 * クロスブラウザ スクリーンショット比較テスト
 * 対象URL: https://www.hokkaido-heim.com/
 * ブラウザ: Chromium / Firefox / WebKit（Safari相当）
 *
 * ローカル実行（Intel Mac または Linux のみ）:
 *   npm install playwright pixelmatch pngjs
 *   npm install --save-dev @types/node @types/pixelmatch @types/pngjs ts-node typescript
 *   npx playwright install chromium firefox webkit
 *   npx ts-node --project tsconfig.json screenshot-test.ts
 *
 * Apple Silicon Mac の場合は GitHub Actions 経由で実行してください。
 */

import { chromium, firefox, webkit, Browser, BrowserContext } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as path from 'path';

const TARGET_URL = 'https://www.hokkaido-heim.com/';
const OUTPUT_DIR = 'screenshots';
const DIFF_DIR   = 'screenshots/diff';

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile:  { width: 390,  height: 844 },
};

const BROWSERS = [
  { name: 'chromium', launcher: chromium },
  { name: 'firefox',  launcher: firefox  },
  { name: 'webkit',   launcher: webkit   },
];

// 差分比較の基準ブラウザ
const BASELINE_BROWSER = 'chromium';

async function takeScreenshot(
  browser: Browser,
  browserName: string,
  viewportName: string,
  viewport: { width: number; height: number },
  isMobile: boolean
): Promise<string> {
  // FirefoxはisMobileをサポートしないため、mobileはビューポートサイズのみ変更
  const supportsIsMobile = browserName !== 'firefox';
  const contextOptions: Parameters<Browser['newContext']>[0] = {
    viewport,
    ...(isMobile && supportsIsMobile && {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      hasTouch: true,
      isMobile: true,
    }),
  };

  const context: BrowserContext = await browser.newContext(contextOptions);
  const page = await context.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });

  // アニメーション・トランジションを無効化して安定したキャプチャを取得
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      transition-duration: 0s !important;
    }`,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `${browserName}_${viewportName}_${timestamp}.png`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  撮影完了: ${filepath}`);

  await context.close();
  return filepath;
}

function diffScreenshots(
  baselinePath: string,
  targetPath: string,
  diffPath: string
): { diffPixels: number; totalPixels: number; diffPercent: string } {
  const img1 = PNG.sync.read(fs.readFileSync(baselinePath));
  const img2 = PNG.sync.read(fs.readFileSync(targetPath));

  const width  = Math.min(img1.width,  img2.width);
  const height = Math.min(img1.height, img2.height);
  const diff   = new PNG({ width, height });

  const diffPixels  = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const diffPercent = ((diffPixels / totalPixels) * 100).toFixed(2);
  return { diffPixels, totalPixels, diffPercent };
}

async function main() {
  [OUTPUT_DIR, DIFF_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const screenshotMap: Record<string, string> = {};

  console.log('=== スクリーンショット撮影開始 ===\n');

  for (const { name, launcher } of BROWSERS) {
    console.log(`[${name}] 起動中...`);
    const browser = await launcher.launch({ headless: true });

    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      const isMobile = viewportName === 'mobile';
      const filepath  = await takeScreenshot(browser, name, viewportName, viewport, isMobile);
      screenshotMap[`${name}_${viewportName}`] = filepath;
    }

    await browser.close();
    console.log(`[${name}] 完了\n`);
  }

  console.log('=== 差分比較開始 ===\n');

  const report: Array<{
    viewport: string;
    browser: string;
    diffPixels: number;
    diffPercent: string;
    diffFile: string;
  }> = [];

  for (const viewportName of Object.keys(VIEWPORTS)) {
    const baselinePath = screenshotMap[`${BASELINE_BROWSER}_${viewportName}`];
    if (!baselinePath) continue;

    for (const { name } of BROWSERS) {
      if (name === BASELINE_BROWSER) continue;

      const targetPath = screenshotMap[`${name}_${viewportName}`];
      if (!targetPath) continue;

      const diffFilename = `diff_${BASELINE_BROWSER}_vs_${name}_${viewportName}.png`;
      const diffPath     = path.join(DIFF_DIR, diffFilename);
      const result       = diffScreenshots(baselinePath, targetPath, diffPath);

      report.push({
        viewport: viewportName,
        browser: `${BASELINE_BROWSER} vs ${name}`,
        ...result,
        diffFile: diffPath,
      });

      const status = Number(result.diffPercent) > 5 ? '⚠️  要確認' : '✅ 問題なし';
      console.log(`[${viewportName}] ${BASELINE_BROWSER} vs ${name}: 差分 ${result.diffPixels}px (${result.diffPercent}%) ${status}`);
      console.log(`  差分画像: ${diffPath}`);
    }
  }

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ url: TARGET_URL, date: new Date().toISOString(), report }, null, 2)
  );
  console.log(`\n=== 完了 ===`);
  console.log(`レポート: ${reportPath}`);
  console.log(`差分画像: ${DIFF_DIR}/`);
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
