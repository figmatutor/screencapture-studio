const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

class AppStoreCrawler {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || 30000,
      maxScreenshots: options.maxScreenshots || 20,
      captureWidth: options.captureWidth || 1440, // 캡처 이미지 고정 width
      ...options
    };
    
    this.browser = null;
    this.screenshots = [];
    this.appInfo = {};
  }

  async initialize() {
    try {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security'
        ],
        defaultViewport: {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1
        }
      });
      
      console.log('🚀 앱스토어 크롤러 브라우저가 초기화되었습니다.');
      return true;
    } catch (error) {
      console.error('❌ 브라우저 초기화 실패:', error);
      throw error;
    }
  }

  async crawlAppStore(appStoreUrl) {
    try {
      const page = await this.browser.newPage();
      
      // User-Agent 설정
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      console.log(`📱 앱스토어 크롤링 시작: ${appStoreUrl}`);
      
      // 앱스토어 타입 감지
      const storeType = this.detectStoreType(appStoreUrl);
      
      if (storeType === 'apple') {
        return await this.crawlAppleAppStore(page, appStoreUrl);
      } else if (storeType === 'google') {
        return await this.crawlGooglePlayStore(page, appStoreUrl);
      } else {
        throw new Error('지원하지 않는 앱스토어입니다. Apple App Store 또는 Google Play Store URL을 사용해주세요.');
      }
      
    } catch (error) {
      console.error('❌ 앱스토어 크롤링 실패:', error);
      throw error;
    }
  }

  detectStoreType(url) {
    if (url.includes('apps.apple.com') || url.includes('itunes.apple.com')) {
      return 'apple';
    } else if (url.includes('play.google.com')) {
      return 'google';
    }
    return 'unknown';
  }

  async crawlAppleAppStore(page, url) {
    console.log('🍎 Apple App Store 크롤링 중...');
    
    await page.goto(url, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: this.options.timeout
    });

    // 페이지 로딩 대기
    await page.waitForTimeout(3000);

    // 앱 정보 추출
    this.appInfo = await page.evaluate(() => {
      const getTextContent = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : '';
      };

      return {
        title: getTextContent('h1.app-header__title'),
        developer: getTextContent('.app-header__identity a'),
        description: getTextContent('.app-description'),
        category: getTextContent('.app-header__list .app-header__list__item:first-child'),
        rating: getTextContent('.we-customer-ratings__averages__display'),
        version: getTextContent('.whats-new__latest__version'),
        size: getTextContent('.app-header__list .app-header__list__item:nth-child(5)'),
        compatibility: getTextContent('.app-header__list .app-header__list__item:last-child')
      };
    });

    console.log(`📱 앱 정보 수집 완료: ${this.appInfo.title}`);

    // 스크린샷 이미지 URL 추출
    const screenshotUrls = await page.evaluate(() => {
      const images = document.querySelectorAll('.we-screenshot-viewer__screenshots img, .we-screenshot-viewer img');
      return Array.from(images).map(img => ({
        url: img.src,
        alt: img.alt || '',
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height
      })).filter(item => item.url && item.url.startsWith('http'));
    });

    console.log(`🖼️ ${screenshotUrls.length}개의 스크린샷을 발견했습니다.`);

    // 스크린샷 다운로드
    for (let i = 0; i < Math.min(screenshotUrls.length, this.options.maxScreenshots); i++) {
      const screenshot = screenshotUrls[i];
      try {
        const filename = await this.downloadScreenshot(screenshot.url, i + 1, 'apple');
        this.screenshots.push({
          filename,
          originalUrl: screenshot.url,
          alt: screenshot.alt,
          width: screenshot.width,
          height: screenshot.height,
          index: i + 1
        });
        console.log(`📸 스크린샷 ${i + 1} 다운로드 완료: ${filename}`);
      } catch (error) {
        console.warn(`⚠️ 스크린샷 ${i + 1} 다운로드 실패:`, error.message);
      }
    }

    await page.close();
    return this.generateResult();
  }

  async crawlGooglePlayStore(page, url) {
    console.log('🤖 Google Play Store 크롤링 중...');
    
    await page.goto(url, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: this.options.timeout
    });

    // 페이지 로딩 대기
    await page.waitForTimeout(3000);

    // 앱 정보 추출
    this.appInfo = await page.evaluate(() => {
      const getTextContent = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : '';
      };

      return {
        title: getTextContent('h1[itemprop="name"] span'),
        developer: getTextContent('a[href*="/store/apps/developer"]'),
        description: getTextContent('[data-g-id="description"] div'),
        category: getTextContent('a[href*="/store/apps/category"] span'),
        rating: getTextContent('.TT9eCd'),
        installs: getTextContent('.ClM7O:contains("installs"), .ClM7O:contains("downloads")'),
        size: getTextContent('.ClM7O:contains("MB"), .ClM7O:contains("KB"), .ClM7O:contains("GB")'),
        version: getTextContent('.ClM7O:contains("Version")')
      };
    });

    console.log(`📱 앱 정보 수집 완료: ${this.appInfo.title}`);

    // 스크린샷 이미지 URL 추출
    const screenshotUrls = await page.evaluate(() => {
      const images = document.querySelectorAll('img[alt*="screenshot"], [data-screenshot] img, .Q4gGE img');
      return Array.from(images).map(img => ({
        url: img.src,
        alt: img.alt || '',
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height
      })).filter(item => item.url && item.url.startsWith('http') && 
                 (item.url.includes('screenshot') || item.alt.toLowerCase().includes('screenshot')));
    });

    console.log(`🖼️ ${screenshotUrls.length}개의 스크린샷을 발견했습니다.`);

    // 스크린샷 다운로드
    for (let i = 0; i < Math.min(screenshotUrls.length, this.options.maxScreenshots); i++) {
      const screenshot = screenshotUrls[i];
      try {
        const filename = await this.downloadScreenshot(screenshot.url, i + 1, 'google');
        this.screenshots.push({
          filename,
          originalUrl: screenshot.url,
          alt: screenshot.alt,
          width: screenshot.width,
          height: screenshot.height,
          index: i + 1
        });
        console.log(`📸 스크린샷 ${i + 1} 다운로드 완료: ${filename}`);
      } catch (error) {
        console.warn(`⚠️ 스크린샷 ${i + 1} 다운로드 실패:`, error.message);
      }
    }

    await page.close();
    return this.generateResult();
  }

  async downloadScreenshot(imageUrl, index, storeType) {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const extension = imageUrl.includes('.webp') ? 'webp' : 
                      imageUrl.includes('.jpg') ? 'jpg' : 
                      imageUrl.includes('.jpeg') ? 'jpeg' : 'png';
      
      const tempFilename = `temp_${storeType}_app_screenshot_${index}_${timestamp}.${extension}`;
      const filename = `${storeType}_app_screenshot_${index}_${timestamp}.png`; // 최종적으로 PNG로 저장
      const tempFilepath = path.join(__dirname, '../screenshots', tempFilename);
      const finalFilepath = path.join(__dirname, '../screenshots', filename);
      
      // 디렉토리 생성
      fs.ensureDirSync(path.dirname(tempFilepath));
      
      const file = fs.createWriteStream(tempFilepath);
      
      https.get(imageUrl, async (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', async () => {
          file.close();
          
          try {
            // Sharp를 사용해서 width 1440px로 리사이징 (비율 유지)
            const image = sharp(tempFilepath);
            const metadata = await image.metadata();
            
            console.log(`📏 원본 앱 스크린샷 크기: ${metadata.width}x${metadata.height}`);
            
            // 1440px width로 리사이징 (비율 유지)
            await image
              .resize(this.options.captureWidth, null, {
                withoutEnlargement: false, // 확대 허용
                fit: 'inside' // 비율 유지하면서 내부에 맞춤
              })
              .png({ quality: 90 }) // PNG 품질 설정
              .toFile(finalFilepath);
            
            // 임시 파일 삭제
            await fs.remove(tempFilepath);
            
            // 최종 이미지 메타데이터 수집
            const finalImage = sharp(finalFilepath);
            const finalMetadata = await finalImage.metadata();
            const stats = await fs.stat(finalFilepath);
            
            console.log(`📸 앱 스크린샷 리사이징 완료: ${filename}`);
            console.log(`📏 최종 크기: ${finalMetadata.width}x${finalMetadata.height} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
            
            resolve(filename);
          } catch (resizeError) {
            console.error('이미지 리사이징 실패:', resizeError);
            // 리사이징 실패 시 원본 파일을 최종 파일로 이동
            await fs.move(tempFilepath, finalFilepath);
            resolve(filename);
          }
        });
        
        file.on('error', (error) => {
          fs.unlink(tempFilepath, () => {}); // 실패 시 파일 삭제
          reject(error);
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  generateResult() {
    return {
      success: true,
      appInfo: this.appInfo,
      screenshots: this.screenshots,
      totalScreenshots: this.screenshots.length,
      timestamp: new Date().toISOString()
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = AppStoreCrawler;
