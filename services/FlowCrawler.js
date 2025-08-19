const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const URL = require('url-parse');
const sharp = require('sharp');

// 전역 브라우저 인스턴스 풀
let browserPool = [];
let poolSize = 0;
const MAX_POOL_SIZE = 3;
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 2;

// 성능 최적화 모드 설정
const FAST_MODE = true; // true로 설정하면 빠른 캡처 모드 활성화

class FlowCrawler {
  constructor(options = {}) {
    this.options = {
      maxPages: options.maxPages || 20,
      maxDepth: options.maxDepth || 3,
      viewport: FAST_MODE ? { width: 1280, height: 720 } : options.viewport || { width: 1920, height: 1080 },
      captureWidth: options.captureWidth || 1440, // 캡처 이미지 고정 width
      timeout: FAST_MODE ? 3000 : options.timeout || 30000, // FAST_MODE에서 3초 타임아웃
      ignorePatterns: options.ignorePatterns || [],
      waitForSelectors: options.waitForSelectors || [],
      blockResources: options.blockResources !== false,
      fastMode: FAST_MODE,
      fullPageCapture: FAST_MODE ? false : (options.fullPageCapture !== false), // FAST_MODE에서는 부분 캡처
      ...options
    };
    
    this.browser = null;
    this.visitedUrls = new Set();
    this.urlQueue = [];
    this.screenshots = [];
    this.flowNodes = [];
    this.errors = [];
    this.baseUrl = null;
    this.baseDomain = null;
    this.jobId = `crawler_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async initialize() {
    // 동시 작업 수 제한
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      throw new Error('현재 처리 중인 작업이 많습니다. 잠시 후 다시 시도해주세요.');
    }
    
    activeJobs++;
    console.log(`🔄 활성 작업 수: ${activeJobs}/${MAX_CONCURRENT_JOBS} (${this.jobId})`);
    
    try {
      // 브라우저 풀에서 가져오기 시도
      this.browser = await this.getBrowserFromPool();
      
      if (!this.browser) {
        // 새 브라우저 인스턴스 생성
        console.log(`🚀 새 브라우저 인스턴스 생성 중... (${this.jobId})`);
        this.browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-first-run',
            '--no-zygote',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-ipc-flooding-protection',
            `--remote-debugging-port=${9222 + poolSize + activeJobs}`, // 포트 충돌 방지
            '--disable-extensions',
            '--disable-plugins'
          ],
          timeout: 20000,
          protocolTimeout: 20000,
        defaultViewport: {
          width: this.options.viewport.width,
          height: this.options.viewport.height,
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
          isLandscape: true
        }
        });
        poolSize++;
      }
      
      console.log(`✅ 브라우저 준비 완료 (${this.jobId})`);
      return true;
    } catch (error) {
      activeJobs--; // 실패 시 카운터 감소
      console.error(`❌ 브라우저 초기화 실패 (${this.jobId}):`, error);
      throw error;
    }
  }

  // 브라우저 풀 관리 메서드들
  async getBrowserFromPool() {
    if (browserPool.length > 0) {
      const browser = browserPool.pop();
      console.log(`♻️ 브라우저 풀에서 재사용 (남은 개수: ${browserPool.length})`);
      
      // 브라우저가 여전히 연결되어 있는지 확인
      try {
        await browser.version();
        return browser;
      } catch (error) {
        console.warn('⚠️ 풀의 브라우저가 연결되지 않음, 새로 생성');
        return null;
      }
    }
    return null;
  }

  async returnBrowserToPool() {
    if (this.browser && browserPool.length < MAX_POOL_SIZE) {
      try {
        // 브라우저 상태 체크
        await this.browser.version();
        browserPool.push(this.browser);
        console.log(`♻️ 브라우저를 풀에 반환 (풀 크기: ${browserPool.length})`);
        this.browser = null;
        return true;
      } catch (error) {
        console.warn('⚠️ 브라우저 반환 실패, 종료 처리');
      }
    }
    
    // 풀이 가득 찼거나 브라우저에 문제가 있으면 종료
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        console.warn('⚠️ 브라우저 종료 중 오류:', error.message);
      }
      this.browser = null;
    }
    return false;
  }

  async crawlWebsite(startUrl, loginCredentials = null) {
    console.log(`🔍 웹사이트 크롤링 시작: ${startUrl}`);
    
    try {
      await this.initialize();
      
      // URL 정규화 및 기본 도메인 설정
      this.baseUrl = this.normalizeUrl(startUrl);
      this.baseDomain = new URL(this.baseUrl).hostname;
      
      // 시작 URL을 큐에 추가
      this.urlQueue.push({
        url: this.baseUrl,
        depth: 0,
        parentUrl: null
      });

      const page = await this.browser.newPage();
      
      // 뷰포트 설정
      await page.setViewport(this.options.viewport);
      
      // 완전한 페이지 렌더링을 위한 리소스 로딩 설정
      if (this.options.fastMode) {
        // FAST_MODE에서도 모든 중요 리소스 로드 허용
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const url = req.url();
          
          // 매우 무거운 광고/트래킹만 선별적 차단
          const heavyTrackingDomains = [
            'googlesyndication.com', 'doubleclick.net', 'facebook.com/tr'
          ];
          
          // 무거운 광고 도메인만 차단
          if (heavyTrackingDomains.some(domain => url.includes(domain))) {
            console.log(`🚫 광고 차단: ${url}`);
            req.abort();
            return;
          }
          
          // CSS, JavaScript, 폰트, 이미지 모두 허용 (완전한 렌더링을 위해)
          req.continue();
        });
      } else {
        // 일반 모드에서는 모든 리소스 로드
        await page.setRequestInterception(false);
      }
      
      // 애니메이션 비활성화 (FAST_MODE)
      if (this.options.fastMode) {
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      }
      
      // 페이지 오류 처리
      page.on('pageerror', (error) => {
        console.log(`⚠️ 페이지 JavaScript 오류: ${error.message}`);
      });
      
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.log(`🔴 콘솔 오류: ${msg.text()}`);
        }
      });

      // 로그인 처리
      if (loginCredentials) {
        await this.handleLogin(page, loginCredentials);
      }

      // BFS 방식으로 페이지 크롤링
      while (this.urlQueue.length > 0 && this.visitedUrls.size < this.options.maxPages) {
        const { url, depth, parentUrl } = this.urlQueue.shift();
        
        if (this.visitedUrls.has(url) || depth > this.options.maxDepth) {
          continue;
        }

        try {
          await this.crawlPage(page, url, depth, parentUrl);
        } catch (error) {
          console.error(`❌ 페이지 크롤링 실패 (${url}):`, error.message);
          this.errors.push({ url, error: error.message });
        }
      }

      await page.close();
      return this.generateResult();
      
    } catch (error) {
      console.error(`❌ 크롤링 중 치명적 오류 (${this.jobId}):`, error);
      throw error;
    } finally {
      // 브라우저를 풀에 반환하거나 종료
      await this.returnBrowserToPool();
      activeJobs--; // 작업 완료 시 카운터 감소
      console.log(`✅ 크롤링 완료, 활성 작업 수: ${activeJobs}/${MAX_CONCURRENT_JOBS} (${this.jobId})`);
    }
  }

  async crawlPage(page, url, depth, parentUrl) {
    console.log(`📄 페이지 크롤링 중: ${url} (깊이: ${depth})`);
    
    try {
      // User-Agent 설정 (실제 브라우저처럼)
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // 뷰포트 설정
      await page.setViewport({
        width: this.options.viewport.width,
        height: this.options.viewport.height,
        deviceScaleFactor: 1
      });

      console.log(`🔗 페이지 이동: ${url}`);
      
      // 완전한 페이지 로딩 (모든 리소스 로드 완료까지 대기)
      const response = await page.goto(url, {
        waitUntil: 'networkidle0', // 모든 리소스 로딩 완료까지 대기
        timeout: this.options.fastMode ? 15000 : this.options.timeout // FAST_MODE에서도 충분한 시간 제공
      });
      
      console.log(`📡 응답: ${response?.status()}`);
      if (!response?.ok()) {
        throw new Error(`HTTP ${response?.status()} 오류`);
      }

      // 완전한 렌더링 대기 (CSS, 폰트, 이미지 모두 로딩 완료)
      console.log('🎨 페이지 렌더링 완료 대기 중...');
      
      try {
        // 1. 모든 스타일시트 로딩 완료 대기
        await page.waitForFunction(() => {
          const styleSheets = document.styleSheets;
          if (styleSheets.length === 0) return false;
          
          for (let i = 0; i < styleSheets.length; i++) {
            try {
              // 스타일시트 로딩 완료 확인
              const sheet = styleSheets[i];
              if (!sheet.cssRules && !sheet.rules) return false;
            } catch (e) {
              // 외부 스타일시트는 보안상 접근 불가능할 수 있음
              continue;
            }
          }
          return true;
        }, { timeout: 10000 });
        
        console.log('✅ 스타일시트 로딩 완료');
      } catch (e) {
        console.log('⚠️ 스타일시트 로딩 확인 실패, 계속 진행');
      }

      try {
        // 2. 폰트 로딩 완료 대기
        await page.evaluate(() => {
          return document.fonts ? document.fonts.ready : Promise.resolve();
        });
        
        console.log('✅ 폰트 로딩 완료');
      } catch (e) {
        console.log('⚠️ 폰트 로딩 확인 실패, 계속 진행');
      }

      try {
        // 3. 이미지 로딩 완료 대기
        await page.waitForFunction(() => {
          const images = document.querySelectorAll('img');
          for (let img of images) {
            if (!img.complete) return false;
          }
          return true;
        }, { timeout: 8000 });
        
        console.log('✅ 이미지 로딩 완료');
      } catch (e) {
        console.log('⚠️ 이미지 로딩 확인 실패, 계속 진행');
      }

      // 4. 추가 렌더링 안정화 대기
      await page.waitForTimeout(this.options.fastMode ? 1000 : 2000);
      console.log('🎨 페이지 렌더링 완료!');
      
      // JavaScript 함수들이 정상적으로 로딩되었는지 확인
      try {
        const jsCheckResult = await page.evaluate(() => {
          // 주요 함수들이 정의되어 있는지 확인
          const requiredFunctions = ['startDemo', 'switchTab', 'startAppDemo', 'startMobileFlowCapture'];
          const functionStatus = {};
          
          requiredFunctions.forEach(fn => {
            functionStatus[fn] = {
              exists: typeof window[fn] === 'function',
              type: typeof window[fn]
            };
          });
          
          // 이벤트 리스너가 제대로 등록되었는지 확인
          const demoBtn = document.getElementById('demoBtn');
          const hasEventListener = demoBtn && demoBtn.onclick === null; // onclick이 null이면 addEventListener로 등록됨
          
          return {
            functions: functionStatus,
            eventListenerRegistered: hasEventListener,
            domReady: document.readyState,
            errors: window.jsErrors || []
          };
        });
        
        console.log(`📊 JavaScript 상태 체크 결과:`, jsCheckResult);
        
        // 함수가 정의되지 않은 경우 경고
        const missingFunctions = Object.entries(jsCheckResult.functions)
          .filter(([name, status]) => !status.exists)
          .map(([name]) => name);
          
        if (missingFunctions.length > 0) {
          console.warn(`⚠️ 누락된 함수들: ${missingFunctions.join(', ')}`);
        }
        
      } catch (error) {
        console.warn('⚠️ JavaScript 함수 체크 실패:', error.message);
      }

      // 커스텀 셀렉터 대기
      for (const selector of this.options.waitForSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
        } catch (e) {
          console.warn(`⚠️ 셀렉터 대기 실패: ${selector}`);
        }
      }

      // 페이지 제목 추출
      const title = await page.title();
      
      // 스크린샷 캡처
      const screenshotPath = await this.captureFullPageScreenshot(page, url);
      
      // 페이지를 방문했다고 표시
      this.visitedUrls.add(url);
      
      // 플로우 노드 생성
      const nodeId = this.generateNodeId(url);
      this.flowNodes.push({
        id: nodeId,
        url,
        title,
        screenshotPath,
        depth,
        parentUrl,
        capturedAt: new Date().toISOString()
      });

      // 내부 링크 추출 및 큐에 추가
      if (depth < this.options.maxDepth) {
        const links = await this.extractInternalLinks(page, url);
        for (const link of links) {
          if (!this.visitedUrls.has(link) && !this.isIgnoredUrl(link)) {
            this.urlQueue.push({
              url: link,
              depth: depth + 1,
              parentUrl: url
            });
          }
        }
      }

    } catch (error) {
      throw new Error(`페이지 로드 실패: ${error.message}`);
    }
  }

  async captureFullPageScreenshot(page, url) {
    try {
      console.log(`📸 스크린샷 캡처: ${url}`);
      
      // 스크린샷 캡처 전 최종 렌더링 확인
      console.log('📸 스크린샷 캡처 준비 중...');
      
      // 스크롤 이벤트를 통한 레이지 로딩 콘텐츠 로드
      try {
        await page.evaluate(() => {
          return new Promise((resolve) => {
            const scrollStep = () => {
              window.scrollBy(0, window.innerHeight);
              if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
                window.scrollTo(0, 0); // 맨 위로 스크롤
                setTimeout(resolve, 500);
              } else {
                setTimeout(scrollStep, 100);
              }
            };
            scrollStep();
          });
        });
        console.log('✅ 페이지 스크롤 및 레이지 로딩 완료');
      } catch (e) {
        console.log('⚠️ 스크롤 처리 실패, 계속 진행');
      }

      // requestAnimationFrame을 통한 렌더링 완료 확인
      try {
        await page.evaluate(() => {
          return new Promise((resolve) => {
            let frameCount = 0;
            const checkFrame = () => {
              frameCount++;
              if (frameCount >= 3) { // 3프레임 대기
                resolve();
              } else {
                requestAnimationFrame(checkFrame);
              }
            };
            requestAnimationFrame(checkFrame);
          });
        });
        console.log('✅ 렌더링 프레임 안정화 완료');
      } catch (e) {
        console.log('⚠️ 렌더링 프레임 확인 실패, 계속 진행');
      }

      // 최종 대기
      await page.waitForTimeout(500);

      const filename = this.generateScreenshotFilename(url);
      const originalPath = path.join(__dirname, '../screenshots', `temp_${filename}`);
      const finalPath = path.join(__dirname, '../screenshots', filename);
      
      // 디렉토리 생성
      await fs.ensureDir(path.dirname(finalPath));
      
      // 완전한 페이지 스크린샷 캡처 (고품질)
      const screenshotOptions = {
        path: originalPath,
        fullPage: true, // 항상 전체 페이지 캡처
        type: 'png',
        captureBeyondViewport: true,
        optimizeForSpeed: false // 품질 우선
      };
      
      console.log('📸 전체 페이지 스크린샷 캡처 중...');
      await page.screenshot(screenshotOptions);
      console.log('✅ 스크린샷 캡처 완료');

      // Sharp를 사용해서 width 1440px로 리사이징 (비율 유지)
      const image = sharp(originalPath);
      const metadata = await image.metadata();
      
      console.log(`📏 원본 이미지 크기: ${metadata.width}x${metadata.height}`);
      
      // 1440px width로 리사이징 (비율 유지)
      await image
        .resize(this.options.captureWidth, null, {
          withoutEnlargement: false, // 확대 허용
          fit: 'inside' // 비율 유지하면서 내부에 맞춤
        })
        .png({ quality: this.options.fastMode ? 70 : 90 }) // FAST_MODE에서 품질 절약
        .toFile(finalPath);
      
      // 임시 파일 삭제
      await fs.remove(originalPath);
      
      // 최종 이미지 메타데이터 수집
      const finalImage = sharp(finalPath);
      const finalMetadata = await finalImage.metadata();
      const stats = await fs.stat(finalPath);
      
      console.log(`📸 스크린샷 리사이징 완료: ${filename}`);
      console.log(`📏 최종 크기: ${finalMetadata.width}x${finalMetadata.height} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
      
      return finalPath;
      
    } catch (error) {
      console.error(`❌ 스크린샷 캡처 실패 (${url}):`, error);
      throw error;
    }
  }



  async extractInternalLinks(page, currentUrl) {
    try {
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors.map(a => a.href).filter(href => {
          if (!href) return false;
          if (href.startsWith('#')) return false;
          if (href.startsWith('javascript:')) return false;
          if (href.startsWith('mailto:')) return false;
          if (href.startsWith('tel:')) return false;
          return true;
        });
      });

      // 내부 링크만 필터링 및 Hash URL 제거
      return links.filter(link => {
        try {
          const linkUrl = new URL(link);
          const currentUrlObj = new URL(currentUrl);
          
          // 동일 도메인인지 확인
          if (linkUrl.hostname !== this.baseDomain) {
            return false;
          }
          
          // Hash-only URL 필터링 (동일한 path에서 hash만 다른 경우)
          if (linkUrl.pathname === currentUrlObj.pathname && 
              linkUrl.search === currentUrlObj.search && 
              linkUrl.hash) {
            console.log(`🚫 Hash-only URL 제외: ${link}`);
            return false;
          }
          
          // 정규화된 URL로 중복 확인
          const normalizedLink = this.normalizeUrl(link);
          if (this.visitedUrls.has(normalizedLink)) {
            return false;
          }
          
          return true;
        } catch (e) {
          return false;
        }
      }).map(link => this.normalizeUrl(link));
      
    } catch (error) {
      console.error('❌ 링크 추출 실패:', error);
      return [];
    }
  }

  async handleLogin(page, credentials) {
    try {
      console.log('🔐 로그인 처리 중...');
      
      // 로그인 페이지로 이동
      if (credentials.loginUrl) {
        await page.goto(credentials.loginUrl, { waitUntil: 'networkidle2' });
      }

      // 로그인 폼 입력
      if (credentials.usernameSelector && credentials.username) {
        await page.waitForSelector(credentials.usernameSelector);
        await page.type(credentials.usernameSelector, credentials.username);
      }

      if (credentials.passwordSelector && credentials.password) {
        await page.waitForSelector(credentials.passwordSelector);
        await page.type(credentials.passwordSelector, credentials.password);
      }

      // 로그인 버튼 클릭
      if (credentials.submitSelector) {
        await page.click(credentials.submitSelector);
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
      }

      console.log('✅ 로그인 완료');
      
    } catch (error) {
      console.error('❌ 로그인 실패:', error);
      throw error;
    }
  }

  normalizeUrl(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Hash 부분 제거 (중복 크롤링 방지)
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';
      return urlObj.toString();
    } catch (error) {
      console.warn('⚠️ URL 정규화 실패:', url, error.message);
      return url;
    }
  }

  generateNodeId(url) {
    return Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
  }

  generateScreenshotFilename(url) {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname === '/' ? 'index' : urlObj.pathname.replace(/\//g, '_');
    const timestamp = Date.now();
    return `${urlObj.hostname}_${pathname}_${timestamp}.png`;
  }

  isIgnoredUrl(url) {
    return this.options.ignorePatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return url.includes(pattern);
      } else if (pattern instanceof RegExp) {
        return pattern.test(url);
      }
      return false;
    });
  }

  generateResult() {
    return {
      success: true,
      totalPages: this.visitedUrls.size,
      screenshots: this.flowNodes,
      flowChart: this.generateFlowChart(),
      errors: this.errors,
      completedAt: new Date().toISOString()
    };
  }

  generateFlowChart() {
    const nodes = this.flowNodes.map(node => ({
      id: node.id,
      label: node.title || node.url,
      url: node.url,
      level: node.depth
    }));

    const edges = this.flowNodes
      .filter(node => node.parentUrl)
      .map(node => ({
        from: this.generateNodeId(node.parentUrl),
        to: node.id,
        label: 'navigates to'
      }));

    return { nodes, edges };
  }
}

module.exports = FlowCrawler;
